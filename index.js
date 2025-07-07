const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.use(bodyParser.json());

// Temporary in-memory user state store
const userStates = {};

// Define your questions here
const questions = [
  "Hey! 👋 Thanks for reaching out. What's your full name?",
  "Great, what's your address?",
  "What kind of project are you looking for? (e.g., fence, deck, windows)",
  "When are you hoping to get started?",
  "What's the best phone number to reach you at?"
];

// Handle webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// Handle incoming messages
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      for (const messagingEvent of entry.messaging) {
        const senderId = messagingEvent.sender.id;

        // Initialize state if new user
        if (!userStates[senderId]) {
          userStates[senderId] = { step: 0, answers: [] };
        }

        // Check for user response
        if (messagingEvent.message && messagingEvent.message.text) {
          const userMessage = messagingEvent.message.text;
          const userData = userStates[senderId];

          // Save answer from previous question
          if (userData.step > 0) {
            userData.answers.push(userMessage);
          }

          // If we have more questions, ask next
          if (userData.step < questions.length) {
            const nextQuestion = questions[userData.step];
            userData.step += 1;
            await sendMessage(senderId, nextQuestion);
          } else {
            // All done
            console.log("✅ Final data for user:", userData.answers);
            await sendMessage(senderId, "Thanks! We'll be in touch soon. 👍");
            // TODO: Save userData.answers to Google Sheets or CRM

            // Reset for possible future restart
            delete userStates[senderId];
          }
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// Send message function
async function sendMessage(recipientId, text) {
  await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: text }
    })
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});





