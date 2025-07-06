const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.use(bodyParser.json());

// Health check
app.get('/', (req, res) => {
  res.send('Messenger bot is running');
});

// Webhook verification
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

// Handle incoming messages
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const responseText = 'Hi there! This is a test auto-reply.';

        await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: senderId },
            message: { text: responseText },
          }),
        });
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

