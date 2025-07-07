// index.js
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.use(bodyParser.json());

const userSessions = {};

// Basic webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Message handler
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const userInput = webhookEvent.message.text.trim().toLowerCase();
        userSessions[senderId] = userSessions[senderId] || { stage: 'start' };
        const session = userSessions[senderId];

        let response = '';

        switch (session.stage) {
          case 'start':
            response = "Hey there! 👋 What kind of service are you interested in? (Windows, Doors, Decks, Roofing, Gutters)";
            session.stage = 'awaiting_service';
            break;

          case 'awaiting_service':
            if (userInput.includes('window')) {
              session.service = 'windows';
              response = "Are you looking to repair or replace your windows?";
              session.stage = 'windows_repair_or_replace';
            } else if (userInput.includes('door')) {
              session.service = 'doors';
              response = "Repair or replace the door(s)? Just a heads up — repairs start at $849 minimum.";
              session.stage = 'doors_repair_or_replace';
            } else if (userInput.includes('deck')) {
              session.service = 'decks';
              response = "Are we talking new construction, resurface, or replace? (We don't offer repairs)";
              session.stage = 'decks_type';
            } else if (userInput.includes('roof')) {
              session.service = 'roofing';
              response = "Are you replacing your roof or installing a new one?";
              session.stage = 'roofing_type';
            } else if (userInput.includes('gutter')) {
              session.service = 'gutters';
              response = "Are you looking for a full gutter replacement?";
              session.stage = 'gutters_type';
            } else {
              response = "Hmm, I didn’t catch that — please reply with one of: Windows, Doors, Decks, Roofing, or Gutters.";
            }
            break;

          case 'windows_repair_or_replace':
            if (userInput.includes('repair')) {
              response = "Unfortunately we don’t offer window repairs — only full replacements.";
              session.stage = 'done';
            } else {
              session.replace = true;
              response = "Great! How many windows are we replacing?";
              session.stage = 'windows_how_many';
            }
            break;

          case 'windows_how_many':
            session.howMany = userInput;
            response = "Awesome — how soon are you looking to start?";
            session.stage = 'windows_how_soon';
            break;

          case 'windows_how_soon':
            session.howSoon = userInput;
            response = "Thanks! We’ll be in touch shortly with a quote. 😊";
            session.stage = 'done';
            break;

          case 'doors_repair_or_replace':
            if (userInput.includes('repair')) {
              response = "We typically don't offer door repairs unless it's a full replacement. Would you like to move forward with a replacement?";
              session.stage = 'doors_confirm_replace';
            } else {
              response = "Interior or exterior door(s)?";
              session.stage = 'doors_type';
            }
            break;

          case 'doors_confirm_replace':
            if (userInput.includes('no')) {
              response = "Totally understand. Feel free to message us again when you're ready. 🙂";
              session.stage = 'done';
            } else {
              response = "Interior or exterior door(s)?";
              session.stage = 'doors_type';
            }
            break;

          case 'doors_type':
            session.doorType = userInput;
            response = "Got it. How many doors are you looking to replace?";
            session.stage = 'doors_how_many';
            break;

          case 'doors_how_many':
            session.howMany = userInput;
            response = "And how soon are you hoping to get started?";
            session.stage = 'doors_how_soon';
            break;

          case 'doors_how_soon':
            session.howSoon = userInput;
            response = "Perfect! We'll be in touch soon with the next steps. Thanks for reaching out! 🙌";
            session.stage = 'done';
            break;

          default:
            response = "Thanks again! If you'd like to start over, just say 'hi'.";
            break;
        }

        await sendMessage(senderId, response);
      }
    }
    res.sendStatus(200);
  }
});

async function sendMessage(senderId, message) {
  await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text: message }
      })
    });
}

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));



