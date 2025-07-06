const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config(); // If you're testing locally

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

app.use(bodyParser.json());

// Health check route
app.get('/', (req, res) => {
  res.send('Messenger bot is running');
});

// Facebook webhook verification endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified!');
      res.status(200).send(challenge);
    } else {
      console.warn('❌ Webhook verification failed');
      res.sendStatus(403);
    }
  }
});

// (Optional) This is where messages will be sent later
app.post('/webhook', (req, res) => {
  console.log('📥 Received message webhook:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200); // Acknowledge to Facebook
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

