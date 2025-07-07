const stringSimilarity = require('string-similarity');
const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

app.use(bodyParser.json());

const userStates = {}; // tracks where each user is in the flow
const userResponses = {}; // tracks their answers

// Root route
app.get('/', (req, res) => {
  res.send('Messenger bot is running.');
});

// Facebook Webhook verification
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

// Handle incoming messages
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const msg = webhookEvent.message.text.trim().toLowerCase();

        if (msg === 'exit' || msg === 'cancel') {
          await sendMessage(senderId, "No worries! If you change your mind, just send us a message. 👋");
          delete userStates[senderId];
          delete userResponses[senderId];
          continue;
        }

        if (!userStates[senderId]) {
          userStates[senderId] = 'ASK_SERVICE';
          userResponses[senderId] = {};
          await sendMessage(senderId, "👋 Hey there! What service are you interested in? (Deck, Fence, Windows, Roofing, Gutters, Doors)");
        } else {
          await handleConversation(senderId, msg);
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

async function handleConversation(senderId, msg) {
  const state = userStates[senderId];
  const responses = userResponses[senderId];

  switch (state) {
    case 'ASK_SERVICE':
      if (/deck|fence|windows?|roof|gutter|door/.test(msg)) {
        responses.service = msg;
        if (msg.includes('window')) {
          userStates[senderId] = 'WINDOWS_REPAIR_OR_REPLACE';
          await sendMessage(senderId, "Are you looking to repair or replace your windows?");
        } else if (msg.includes('door')) {
          userStates[senderId] = 'DOORS_REPAIR_OR_REPLACE';
          await sendMessage(senderId, "Are you looking to repair or replace your doors?");
        } else if (msg.includes('fence')) {
          userStates[senderId] = 'FENCE_REPAIR_OR_REPLACE';
          await sendMessage(senderId, "Are you looking to repair or replace your fence?");
        } else {
          await sendMessage(senderId, "Thanks! We'll get back to you soon regarding your " + msg + ".");
          delete userStates[senderId];
        }
      } else {
        await sendMessage(senderId, "Please choose one of the following: Deck, Fence, Windows, Roofing, Gutters, Doors.");
      }
      break;

    // WINDOWS
    case 'WINDOWS_REPAIR_OR_REPLACE':
      if (msg === 'repair') {
        await sendMessage(senderId, "Unfortunately, we don't do window repairs. If you’re considering replacement instead, let us know!");
      } else if (msg === 'replace') {
        userStates[senderId] = 'WINDOWS_HOW_MANY';
        await sendMessage(senderId, "How many windows are you looking to replace?");
      } else {
        await sendMessage(senderId, "Please reply with 'repair' or 'replace'.");
      }
      break;

    case 'WINDOWS_HOW_MANY':
      responses.windowsCount = msg;
      userStates[senderId] = 'WINDOWS_SCHEDULE';
      await sendMessage(senderId, "Thanks! When would you like us to schedule your window replacement?");
      break;

    case 'WINDOWS_SCHEDULE':
      responses.schedule = msg;
      await sendMessage(senderId, "✅ Got it! We'll follow up shortly to confirm your appointment. Thanks!");
      delete userStates[senderId];
      break;

    // DOORS
    case 'DOORS_REPAIR_OR_REPLACE':
      if (msg === 'repair') {
        await sendMessage(senderId, "Door repairs start at $849.00 minimum. Would you like to proceed?");
        userStates[senderId] = 'DOORS_REPAIR_CONFIRM';
      } else if (msg === 'replace') {
        userStates[senderId] = 'DOORS_INTERIOR_OR_EXTERIOR';
        await sendMessage(senderId, "Are the doors interior or exterior?");
      } else {
        await sendMessage(senderId, "Please reply with 'repair' or 'replace'.");
      }
      break;

    case 'DOORS_REPAIR_CONFIRM':
      if (msg === 'yes') {
        userStates[senderId] = 'DOORS_SCHEDULE';
        await sendMessage(senderId, "Great! When would you like to schedule the door repair?");
      } else {
        await sendMessage(senderId, "Totally understand. Let us know if you change your mind.");
        delete userStates[senderId];
      }
      break;

    case 'DOORS_INTERIOR_OR_EXTERIOR':
      responses.doorType = msg;
      userStates[senderId] = 'DOORS_HOW_MANY';
      await sendMessage(senderId, "How many doors are you replacing?");
      break;

    case 'DOORS_HOW_MANY':
      responses.doorCount = msg;
      userStates[senderId] = 'DOORS_SCHEDULE';
      await sendMessage(senderId, "Awesome! When should we schedule the replacement?");
      break;

    case 'DOORS_SCHEDULE':
      responses.schedule = msg;
      await sendMessage(senderId, "✅ Got it! We'll confirm your door project shortly. Thank you!");
      delete userStates[senderId];
      break;

    // FENCE
    case 'FENCE_REPAIR_OR_REPLACE':
      if (msg === 'repair') {
        await sendMessage(senderId, "Fence repairs start at $849.00 minimum. Would you like to proceed?");
        userStates[senderId] = 'FENCE_REPAIR_CONFIRM';
      } else if (msg === 'replace') {
        userStates[senderId] = 'FENCE_REPLACE_TYPE';
        await sendMessage(senderId, "What type of fence are you considering? (Wood, Chain-link, Vinyl, Deco Metal)");
      } else {
        await sendMessage(senderId, "Please reply with 'repair' or 'replace'.");
      }
      break;

    case 'FENCE_REPAIR_CONFIRM':
      if (msg === 'yes') {
        userStates[senderId] = 'FENCE_REPAIR_PART';
        await sendMessage(senderId, "Are you repairing posts, panels, or both?");
      } else {
        await sendMessage(senderId, "Understood! Let us know if you'd like to explore other services.");
        delete userStates[senderId];
      }
      break;

    case 'FENCE_REPAIR_PART':
      responses.fencePart = msg;
      userStates[senderId] = 'FENCE_REPAIR_QUANTITY';
      await sendMessage(senderId, "Roughly how many " + msg + " need to be repaired?");
      break;

    case 'FENCE_REPAIR_QUANTITY':
      responses.quantity = msg;
      userStates[senderId] = 'FENCE_SCHEDULE';
      await sendMessage(senderId, "Got it! When should we schedule the repair?");
      break;

    case 'FENCE_REPLACE_TYPE':
      responses.fenceType = msg;
      userStates[senderId] = 'FENCE_REPLACE_LENGTH';
      await sendMessage(senderId, "Approximately how many linear feet?");
      break;

    case 'FENCE_REPLACE_LENGTH':
      responses.linearFeet = msg;
      userStates[senderId] = 'FENCE_EXISTING';
      await sendMessage(senderId, "Is there an existing fence to remove? (Yes/No)");
      break;

    case 'FENCE_EXISTING':
      responses.existingFence = msg;
      userStates[senderId] = 'FENCE_SCHEDULE';
      await sendMessage(senderId, "Thanks! When would you like us to schedule your fence project?");
      break;

    case 'FENCE_SCHEDULE':
      responses.schedule = msg;
      await sendMessage(senderId, "✅ Great! We'll be in touch soon to confirm. Thanks for reaching out to F&F!");
      delete userStates[senderId];
      break;

    default:
      await sendMessage(senderId, "Sorry, I didn’t quite catch that. Let's start over.");
      delete userStates[senderId];
      break;
  }
}

async function sendMessage(senderId, text) {
  await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: senderId },
      message: { text }
    })
  });
}

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));



