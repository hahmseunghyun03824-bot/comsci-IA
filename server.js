const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = 3001;

let chatDb;

async function initializeDatabase() {
    try {
        chatDb = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            database: 'chatDb'
        });
        console.log('Connected to MySQL database!');

        await chatDb.execute(`
            CREATE TABLE IF NOT EXISTS Users (
                UserID INT AUTO_INCREMENT PRIMARY KEY,
                Email VARCHAR(255) UNIQUE NOT NULL,
                Password VARCHAR(255) NOT NULL,
                FirstName VARCHAR(255),
                LastName VARCHAR(255),
                Gender VARCHAR(50),
                GradeLevel VARCHAR(50),
                DOB DATE
            )
        `);
        console.log('Users table ensured.');

        await chatDb.execute(`
            CREATE TABLE IF NOT EXISTS Conversations (
                ChatID INT AUTO_INCREMENT PRIMARY KEY,
                UserID INT NOT NULL,
                SessionID VARCHAR(255) NOT NULL,
                UserMessage TEXT,
                AIMessage TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (UserID) REFERENCES Users(UserID) ON DELETE CASCADE
            )
        `);
        console.log('Conversations table ensured with UserMessage/AIMessage schema.');

    } catch (error) {
        console.error('Error connecting to the database or initializing tables:', error);
        process.exit(1);
    }
}

initializeDatabase();

app.use(cors());
app.use(bodyParser.json());

const authenticateAccess = (req, res, next) => {
    const accessPassword = req.headers['x-access-password'];
    if (accessPassword === 'Ilovebha10') {
        next();
    } else {
        res.status(403).json({ error: 'Access denied: Invalid password' });
    }
};

app.post('/register', async (req, res) => {
    const { email, password, firstName, lastName, gender, gradeLevel, dob = null } = req.body;
    if (!chatDb) { return res.status(500).json({ error: "Database not initialized. Please try again." }); }
    try {
        const hashedPassword = password;
        const [result] = await chatDb.execute(
            'INSERT INTO Users (Email, Password, FirstName, LastName, Gender, GradeLevel, DOB) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [email, hashedPassword, firstName || null, lastName || null, gender, gradeLevel, dob]
        );
        res.status(201).json({ message: 'User registered successfully!', userID: result.insertId });
    } catch (error) {
        console.error('Error during user registration:', error);
        if (error.code === 'ER_DUP_ENTRY') { return res.status(409).json({ error: 'Email already registered.' }); }
        res.status(500).json({ error: 'Failed to register user.', details: error.message });
    }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!chatDb) { return res.status(500).json({ error: "Database not initialized. Please try again." }); }
    try {
        const [rows] = await chatDb.execute('SELECT UserID, Password FROM Users WHERE Email = ?', [email]);
        if (rows.length === 0) { return res.status(401).json({ error: 'Invalid email or password.' }); }
        const user = rows[0];
        const passwordMatch = (password === user.Password);
        if (passwordMatch) { res.status(200).json({ message: 'Login successful!', userID: user.UserID }); }
        else { res.status(401).json({ error: 'Invalid email or password.' }); }
    } catch (error) {
        console.error('Error during user login:', error);
        res.status(500).json({ error: 'Failed to login.', details: error.message });
    }
});

app.post('/save_conversation_session', authenticateAccess, async (req, res) => {
    console.log("Received request to /save_conversation_session", req.body);

    const { userId, conversationId, messages } = req.body;

    // userId를 정수로 변환
    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId)) {
        console.error('Invalid UserID received from request body:', userId);
        return res.status(400).json({ error: 'Invalid UserID provided.' });
    }

    if (!parsedUserId || !conversationId || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'UserID, conversationId, and a non-empty array of messages are required.' });
    }

    if (!chatDb) {
        return res.status(500).json({ error: "Database not initialized. Please try again." });
    }

    try {
        await chatDb.beginTransaction();

        const insertQuery = 'INSERT INTO Conversations (UserID, SessionID, UserMessage, AIMessage, timestamp) VALUES (?, ?, ?, ?, NOW())';

        for (const msg of messages) {
            // msgUserID도 정수로 변환
            const msgUserID = parseInt(msg.userID, 10);
            if (isNaN(msgUserID)) {
                console.warn('Skipping invalid message in batch (UserID is not a number):', msg);
                continue;
            }

            const msgSessionID = msg.chatID;
            const msgType = msg.messageType;
            const msgContent = msg.messageContent;

            let userMsg = null;
            let aiMsg = null;

            if (msgType === 'user') {
                userMsg = msgContent;
            } else if (msgType === 'assistant') {
                aiMsg = msgContent;
            } else {
                console.warn('Skipping invalid message in batch (unknown messageType):', msg);
                continue;
            }

            // 빈 문자열 (또는 공백만 있는 문자열)을 null로 변환하여 MySQL TEXT/VARCHAR 필드에 적절히 저장되도록 함
            if (typeof userMsg === 'string' && userMsg.trim() === '') {
                userMsg = null;
            }
            if (typeof aiMsg === 'string' && aiMsg.trim() === '') {
                aiMsg = null;
            }

            // SessionID와 메시지 내용 중 하나라도 없으면 건너뜀 (UserMessage와 AIMessage가 모두 null인 경우 포함)
            if (!msgSessionID || (userMsg === null && aiMsg === null)) {
                console.warn('Skipping invalid message in batch (missing required fields - SessionID or both UserMessage/AIMessage are empty):', msg);
                continue;
            }

            await chatDb.execute(insertQuery, [msgUserID, msgSessionID, userMsg, aiMsg]);
        }

        await chatDb.commit();
        res.status(201).json({ message: 'Conversation session saved successfully!' });

    } catch (error) {
        // 상세한 에러 로그를 콘솔에 출력
        console.error('Error saving conversation session. Transaction rolled back:', error);
        if (chatDb) {
            await chatDb.rollback();
        }
        res.status(500).json({ error: 'Failed to save conversation session.', details: error.message });
    }
});

app.get('/api/all-users', authenticateAccess, async (req, res) => {
    console.log("Received request to /api/all-users");
    try {
        if (!chatDb) { return res.status(500).json({ error: "Database not initialized. Please try again." }); }
        const [users] = await chatDb.execute('SELECT UserID, FirstName, LastName, Gender, GradeLevel FROM Users');
        res.status(200).json(users);
    } catch (error) {
        console.error('Database error when fetching all users:', error);
        res.status(500).json({ error: 'Failed to fetch users from database', details: error.message });
    }
});

app.get('/api/conversations/:userId', authenticateAccess, async (req, res) => {
    const userId = req.params.userId;
    console.log(`Received request for conversations for UserID: ${userId}`);

    if (!userId) {
        return res.status(400).json({ error: 'UserID is required.' });
    }

    try {
        if (!chatDb) { return res.status(500).json({ error: "Database not initialized. Please try again." }); }
        const [conversations] = await chatDb.execute(
            `SELECT ChatID, UserID, SessionID, UserMessage, AIMessage, timestamp
             FROM Conversations
             WHERE UserID = ?
             ORDER BY SessionID ASC, timestamp ASC`,
            [userId]
        );
        res.status(200).json(conversations);
    } catch (error) {
        console.error(`Database error when fetching conversations for UserID ${userId}:`, error);
        res.status(500).json({ error: 'Failed to fetch conversation history from database', details: error.message });
    }
});

app.post('/chat', async (req, res) => {
    if (!chatDb) { return res.status(500).json({ error: "Database not initialized. Please try again." }); }
    const { messages, userID } = req.body;
    console.log(`Received chat request for UserID: ${userID}`);
    console.log("Chat messages:", messages);

    const ollamaMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content
    }));

    try {
        const ollamaResponse = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llama3',
                messages: ollamaMessages,
                stream: true
            }),
        });

        if (!ollamaResponse.ok) {
            const errorData = await ollamaResponse.json();
            console.error('Ollama API error:', errorData);
            throw new Error(`Ollama API error: ${ollamaResponse.status} - ${errorData.error}`);
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const reader = ollamaResponse.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                console.log("Ollama stream finished.");
                break;
            }
            const chunk = decoder.decode(value, { stream: true });
            chunk.split('\n').forEach(line => {
                if (line.trim() !== '') {
                    try {
                        const jsonData = JSON.parse(line);
                        if (jsonData.message && jsonData.message.content) {
                            res.write(`data: ${JSON.stringify({ content: jsonData.message.content })}\n\n`);
                        }
                    } catch (e) {
                        console.warn('Error parsing Ollama stream chunk:', e, 'Chunk:', line);
                    }
                }
            });
        }
        res.end();

    } catch (error) {
        console.error('Error in /chat route (Ollama communication issue or other error):', error);
        let errorMessage = 'Failed to get response from AI model.';
        if (error.message.includes('ECONNREFUSED')) {
            errorMessage = 'Ollama server is not running or not accessible (connection refused). Please ensure Ollama is running on http://localhost:11434.';
        } else if (error.message.includes('404 model')) {
            errorMessage = `The specified Ollama model 'llama3' was not found. Please run 'ollama pull llama3'`;
        }
        res.status(500).json({ error: errorMessage, details: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('Backend is running!');
});

app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
});
app.get('/api/conversations-by-filters', async (req, res) => {
    try {
        const { userId, startDate, endDate } = req.query; // Get filters from query parameters

        let query = `
            SELECT 
                c.ChatID, 
                c.UserID, 
                u.FirstName, 
                u.LastName, 
                c.SessionID, 
                c.UserMessage, 
                c.AIMessage, 
                c.timestamp 
            FROM Conversations c
            JOIN Users u ON c.UserID = u.UserID
            WHERE 1=1
        `;
        const params = [];

        if (userId) {
            query += ` AND c.UserID = ?`;
            params.push(userId);
        }
        if (startDate) {
            query += ` AND c.timestamp >= ?`;
            params.push(`${startDate} 00:00:00`); // Start of the day
        }
        if (endDate) {
            query += ` AND c.timestamp <= ?`;
            params.push(`${endDate} 23:59:59`); // End of the day
        }

        query += ` ORDER BY c.timestamp DESC`; // Order by most recent conversations

        const [rows] = await chatDb.execute(query, params);
        res.json(rows); // Send the filtered conversations as JSON

    } catch (error) {
        console.error('Error fetching filtered conversations:', error);
        res.status(500).json({ error: 'Failed to fetch filtered conversations.', details: error.message });
    }
});