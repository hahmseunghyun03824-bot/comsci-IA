
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // We still use the 'openai' npm package as it's compatible

const app = express();
const port = 3000; // Or any other port

const OLLAMA_MODEL_NAME = 'llama3'; // e.g., 'mistral', 'llama2', 'codellama'

// Initialize the OpenAI client to point to your local Ollama instance
const openai = new OpenAI({
  baseURL: 'http://localhost:11434/v1', // Ollama's default API endpoint
  apiKey: 'ollama', // Required by the OpenAI SDK, but Ollama's local API doesn't use it for auth
});
// --- End Ollama Configuration ---


app.use(cors()); // Enable CORS for your frontend
app.use(express.json()); // To parse JSON request bodies

// Route to handle chat requests
app.post('/chat', async (req, res) => {
  // Set headers for streaming response (must be done BEFORE any res.write or error response)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { messages } = req.body; // chatHistory from your frontend

  if (!messages || !Array.isArray(messages)) {
    // For initial validation errors, send as an SSE event for consistency with streaming errors.
    res.write(`data: ${JSON.stringify({ error: 'Invalid messages array provided.' })}\n\n`);
    return res.end();
  }

  // No need for explicit API key check here since Ollama doesn't use it for auth.
  // The 'OpenAI API key loaded: true' message will no longer appear when server starts.
  // Instead, successful connection to Ollama will be indicated by the server starting without crash.

  try {
    // Use the OLLAMA_MODEL_NAME defined above
    const stream = await openai.chat.completions.create({
      model: OLLAMA_MODEL_NAME, // Use the locally downloaded Ollama model
      messages: messages,
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 1000,
      stream: true,
    });

    for await (const chunk of stream) {
      // Send data as Server-Sent Events (SSE)
      if (chunk.choices[0].delta && chunk.choices[0].delta.content) {
        res.write(`data: ${JSON.stringify({ content: chunk.choices[0].delta.content })}\n\n`);
      }
    }
    res.end(); // End the stream successfully

  } catch (error) {
    console.error('Ollama API Error:', error); // Changed log message

    let errorMessage = 'An unexpected error occurred with the AI. Please try again later. 💭';

    if (error.response && error.response.data && error.response.data.error) {
        // This path might be less common for local Ollama, but kept for robustness
        errorMessage = `AI Service Error: ${error.response.data.error.message}`;
    } else if (error.message.includes('connect ECONNREFUSED') || error.message.includes('Failed to fetch')) {
        errorMessage = "Could not connect to Ollama. Please ensure Ollama is running and the model is loaded. 🌐";
    } else if (error.message.includes('context_length_exceeded')) {
        errorMessage = "The conversation is too long for the AI. Let's try starting a new topic. 🫂";
    } else {
        errorMessage = `An error occurred: ${error.message}. Please check your Ollama setup.`;
    }

    // Send the error as an SSE event to the client
    res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    res.end(); // Important: End the stream after sending the error
  }
});

app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
  console.log(`Ollama model configured: ${OLLAMA_MODEL_NAME}`);
  console.log(`Ensure Ollama is running and has the '${OLLAMA_MODEL_NAME}' model pulled.`);
});