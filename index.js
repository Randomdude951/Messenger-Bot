const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const stringSimilarity = require('string-similarity');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.use(bodyParser.json());

const serviceKeywords = ['fence', 'deck', 'windows', 'doors', 'roofing', 'gutters'];

function detectService(message) {
  const match = stringSimilarity.findBestMatch(message.toLowerCase(), serviceKeywords);
  return match.bestMatch.rating > 0.5 ? match.bestMatch.target : null;
}

const userStates = {};

function sendText(senderId, text) {
  return fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { text: text }
    })
  });
}

function handleServiceFlow(senderId, service) {
  userStates[senderId] = { step: 'serviceType', service: service };

  switch (service) {
    case 'fence':
      sendText(senderId, 'Are you looking to repair or replace your fence?');
      break;
    case 'windows':
      sendText(senderId, 'Are you looking to repair or replace your windows?');
      break;
    case 'doors':
      sendText(senderId, 'Are you looking to repair or replace your doors?');
      break;
    case 'deck':
      sendText(senderId, 'Are you building a new deck, resurfacing, or replacing an existing one?');
      break;
    case 'roofing':
    case 'gutters':
      sendText(senderId, `Great! Let’s get started with your ${service} project. When are you hoping to get started?`);
      break;
    default:
      sendText(senderId, 'Let’s get started. What kind of service are you interested in?');
  }
}

app.get('/', (req, res) => {
  res.send('Messenger bot is running');
});

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

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const messageText = webhookEvent.message.text.trim().toLowerCase();

        if (['exit', 'cancel', 'stop'].includes(messageText)) {
          sendText(senderId, 'Got it. If you need help in the future, just send a message. 👋');
          delete userStates[senderId];
          continue;
        }

        const guessedService = detectService(messageText);

        if (guessedService) {
          handleServiceFlow(senderId, guessedService);
        } else {
          sendText(senderId, 'Hi! I\'m here to help. What type of service are you looking for? (Fence, Deck, Windows, Doors, Roofing, Gutters)');
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));



