const mineflayer = require('mineflayer');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const http = require('http');

// ════════════════════════════════════════════
//   SHUVO_WOE72 — MULTI SERVER AFK BOT v3.0
//   Anti-kick | Inline Buttons | Auto-reconnect
// ════════════════════════════════════════════

const TOKEN         = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const PASSWORD      = "shuvo123";
const ACCOUNTS_FILE = "all_accounts.json";
const SERVERS_FILE  = "servers.json";

// Keep-alive
http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', bot: 'SHUVO_WOE72', active: activeBots.size }));
  } else {
    res.writeHead(200);
    res.end('SHUVO_WOE72 v3 alive');
  }
}).listen(process.env.PORT || 3000);

// Load accounts
const accounts   = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')).accounts;
let accountIndex = 0;
function getNextAccount() {
  const acc = accounts[accountIndex % accounts.length];
  accountIndex++;
  return acc.username;
}

// Load/Save servers
function loadServers() {
  if (!fs.existsSync(SERVERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
}
function saveServers(list) {
  fs.writeFileSync(SERVERS_FILE, JSON.stringify(list, null, 2));
}

const bot         = new TelegramBot(TOKEN, { polling: true });
const authedUsers = new Set();
const activeBots  = new Map();   // id -> { mcBot, timers[] }
let   adminChatId = null;

// ── Anti-kick behaviors ───────────────────────
function startAntikick(srv, mcBot) {
  const timers = [];

  // 1. Jump every 20s
  timers.push(setInterval(() => {
    try {
      mcBot.setControlState('jump', true);
      setTimeout(() => { try { mcBot.setControlState('jump', false); } catch(e){} }, 400);
    } catch(e) {}
  }, 20000));

  // 2. Sneak toggle every 45s
  timers.push(setInterval(() => {
    try {
      mcBot.setControlState('sneak', true);
      setTimeout(() => { try { mcBot.setControlState('sneak', false); } catch(e){} }, 1000);
    } catch(e) {}
  }, 45000));

  // 3. Random small movement every 60s
  timers.push(setInterval(() => {
    try {
      const dirs = ['forward', 'back', 'left', 'right'];
      const dir  = dirs[Math.floor(Math.random() * dirs.length)];
      mcBot.setControlState(dir, true);
      setTimeout(() => { try { mcBot.setControlState(dir, false); } catch(e){} }, 600);
    } catch(e) {}
  }, 60000));

  // 4. Swing arm (attack air) every 90s
  timers.push(setInterval(() => {
    try { mcBot.swingArm(); } catch(e) {}
  }, 90000));

  return timers;
}

// ── Join one server ───────────────────────────
function joinServer(srv, chatId, silent = false) {
  const { id, name, host, port } = srv;
  if (activeBots.has(id)) {
    if (!silent) bot.sendMessage(chatId, `⚠️ *${name}* already running!`, { parse_mode: 'Markdown' });
    return;
  }

  const username = getNextAccount();
  const mcBot = mineflayer.createBot({
    host: host,
    port: parseInt(port),
    username: username,
    version: '1.21.1',
    auth: 'offline'
  });

  activeBots.set(id, { mcBot, timers: [] });

  mcBot.on('spawn', () => {
    const timers = startAntikick(srv, mcBot);
    activeBots.set(id, { mcBot, timers });

    if (!silent && chatId) {
      bot.sendMessage(chatId,
        `✅ *${name}* joined!\n📡 \`${host}:${port}\`\n👤 \`${username}\`\n🛡️ Anti-kick active`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  function cleanup() {
    const data = activeBots.get(id);
    if (data) data.timers.forEach(t => clearInterval(t));
    activeBots.delete(id);
  }

  mcBot.on('end', (reason) => {
    cleanup();
    const notify = chatId || adminChatId;
    if (notify) bot.sendMessage(notify,
      `❌ *${name}* disconnected\nReason: \`${reason}\`\n🔄 Reconnecting in 15s...`,
      { parse_mode: 'Markdown' }
    );
    setTimeout(() => joinServer(srv, notify, true), 15000);
  });

  mcBot.on('error', (err) => {
    cleanup();
    const notify = chatId || adminChatId;
    if (notify) bot.sendMessage(notify,
      `⚠️ *${name}* error: ${err.message}\n🔄 Retry in 20s...`,
      { parse_mode: 'Markdown' }
    );
    setTimeout(() => joinServer(srv, notify, true), 20000);
  });

  mcBot.on('kicked', (reason) => {
    cleanup();
    const notify = chatId || adminChatId;
    if (notify) bot.sendMessage(notify,
      `🦵 *${name}* was kicked\nReason: ${reason}\n🔄 Retry in 30s...`,
      { parse_mode: 'Markdown' }
    );
    setTimeout(() => joinServer(srv, notify, true), 30000);
  });
}

function stopServer(id) {
  const data = activeBots.get(id);
  if (data) {
    data.timers.forEach(t => clearInterval(t));
    try { data.mcBot.quit(); } catch(e) {}
    activeBots.delete(id);
    return true;
  }
  return false;
}

function requireAuth(msg, cb) {
  if (!authedUsers.has(msg.from.id)) {
    bot.sendMessage(msg.chat.id, '🔐 /login shuvo123');
    return;
  }
  cb();
}

// ════════════════════════════════════════════
//   INLINE BUTTON KEYBOARDS
// ════════════════════════════════════════════

function mainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '▶️ Start All',  callback_data: 'startall'  },
        { text: '⏹️ Stop All',   callback_data: 'stopall'   },
      ],
      [
        { text: '📊 Status',     callback_data: 'status'    },
        { text: '🖥️ Servers',    callback_data: 'servers'   },
      ],
      [
        { text: '➕ Add Server', callback_data: 'add_help'  },
        { text: '🗑️ Remove',     callback_data: 'remove_help'},
      ],
      [
        { text: '🏓 Ping',       callback_data: 'ping'      },
        { text: '❓ Help',        callback_data: 'help'      },
      ],
    ]
  };
}

function serversMenu() {
  const servers = loadServers();
  const rows = servers.map(srv => {
    const on = activeBots.has(srv.id);
    return [
      { text: `${on ? '🟢' : '🔴'} ${srv.name}`, callback_data: `srv_${srv.id}` }
    ];
  });
  rows.push([{ text: '🔙 Back', callback_data: 'menu' }]);
  return { inline_keyboard: rows };
}

function serverActions(srvId, srvName) {
  const on = activeBots.has(srvId);
  return {
    inline_keyboard: [
      [
        on
          ? { text: '⏹️ Stop',   callback_data: `stop_${srvId}`  }
          : { text: '▶️ Start',  callback_data: `start_${srvId}` },
        { text: '📊 Status', callback_data: `info_${srvId}` },
      ],
      [
        { text: '🗑️ Remove',  callback_data: `del_${srvId}` },
        { text: '🔙 Back',    callback_data: 'servers'     },
      ],
    ]
  };
}

// ════════════════════════════════════════════
//   COMMANDS
// ════════════════════════════════════════════

bot.onText(/\/start/, (msg) => {
  const inAuth = authedUsers.has(msg.from.id);
  bot.sendMessage(msg.chat.id,
    `\`\`\`\n╔══════════════════════════╗\n║  🌑  SHUVO_WOE72  🌑   ║\n║  Multi-Server AFK v3.0  ║\n╚══════════════════════════╝\n\`\`\`\n\n` +
    (inAuth ? '✅ Logged in! Use the menu:' : '🔐 Login: /login shuvo123'),
    {
      parse_mode: 'Markdown',
      reply_markup: inAuth ? mainMenu() : undefined
    }
  );
});

bot.onText(/\/login (.+)/, (msg, match) => {
  if (match[1].trim() === PASSWORD) {
    authedUsers.add(msg.from.id);
    if (!adminChatId) adminChatId = msg.chat.id;
    bot.sendMessage(msg.chat.id,
      `✅ *Welcome!* Choose an option:`,
      { parse_mode: 'Markdown', reply_markup: mainMenu() }
    );
  } else {
    bot.sendMessage(msg.chat.id, '❌ Wrong password!');
  }
});

bot.onText(/\/menu/, (msg) => requireAuth(msg, () => {
  bot.sendMessage(msg.chat.id, '📋 *Main Menu:*', { parse_mode: 'Markdown', reply_markup: mainMenu() });
}));

bot.onText(/\/addserver (.+) (.+) (\d+)/, (msg, match) => requireAuth(msg, () => {
  const servers = loadServers();
  const newSrv = {
    id: `srv_${Date.now()}`,
    name: match[1].trim(),
    host: match[2].trim(),
    port: match[3].trim(),
    addedBy: msg.from.username || msg.from.first_name
  };
  servers.push(newSrv);
  saveServers(servers);
  bot.sendMessage(msg.chat.id,
    `✅ *Server Added!*\n🖥️ \`${newSrv.name}\`\n📡 \`${newSrv.host}:${newSrv.port}\`\n\nUse ▶️ Start All or /menu`,
    { parse_mode: 'Markdown', reply_markup: mainMenu() }
  );
}));

bot.onText(/\/addserver$/, (msg) => requireAuth(msg, () => {
  bot.sendMessage(msg.chat.id,
    `📌 *Usage:*\n\`/addserver <name> <ip> <port>\`\n\nExample:\n\`/addserver MySurvival 0.tcp.eu.ngrok.io 12345\``,
    { parse_mode: 'Markdown' }
  );
}));

// ════════════════════════════════════════════
//   CALLBACK BUTTONS
// ════════════════════════════════════════════

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;
  const data   = query.data;
  const userId = query.from.id;

  bot.answerCallbackQuery(query.id);

  if (!authedUsers.has(userId)) {
    bot.sendMessage(chatId, '🔐 /login shuvo123');
    return;
  }

  if (data === 'menu') {
    bot.editMessageText('📋 *Main Menu:*', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: mainMenu() });

  } else if (data === 'startall') {
    const servers = loadServers();
    if (!servers.length) {
      bot.editMessageText('📭 No servers yet!\n\n/addserver <name> <ip> <port>', { chat_id: chatId, message_id: msgId, reply_markup: mainMenu() });
      return;
    }
    adminChatId = chatId;
    servers.forEach(srv => joinServer(srv, chatId));
    bot.editMessageText(`🚀 *Starting ${servers.length} server(s)...*\n🛡️ Anti-kick enabled on all`, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: mainMenu()
    });

  } else if (data === 'stopall') {
    const servers = loadServers();
    let stopped = 0;
    servers.forEach(s => { if (stopServer(s.id)) stopped++; });
    bot.editMessageText(`🛑 *Stopped ${stopped} bot(s)*`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: mainMenu() });

  } else if (data === 'status') {
    const servers = loadServers();
    const online  = servers.filter(s => activeBots.has(s.id)).length;
    let text = `📊 *Status*\n━━━━━━━━━━━━━━\n🟢 Online: *${online}*\n🔴 Offline: *${servers.length - online}*\n\n`;
    servers.forEach(s => {
      text += `${activeBots.has(s.id) ? '🟢' : '🔴'} \`${s.name}\`\n`;
    });
    bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: mainMenu() });

  } else if (data === 'servers') {
    const servers = loadServers();
    if (!servers.length) {
      bot.editMessageText('📭 No servers yet!\n\n/addserver <name> <ip> <port>', { chat_id: chatId, message_id: msgId, reply_markup: mainMenu() });
      return;
    }
    bot.editMessageText('🖥️ *Select a server:*', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: serversMenu() });

  } else if (data === 'ping') {
    bot.editMessageText(`🏓 *Pong!*\n✅ Bot alive!\n📡 Active: *${activeBots.size}*`, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: mainMenu()
    });

  } else if (data === 'help') {
    bot.editMessageText(
      `❓ *Help*\n━━━━━━━━━━━━━━\n▶️ *Start All* — Join all servers\n⏹️ *Stop All* — Disconnect all\n📊 *Status* — Online/offline list\n🖥️ *Servers* — Manage per server\n➕ *Add Server:*\n\`/addserver name ip port\`\n\n🛡️ *Anti-kick:* jump + sneak + move + swing`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: mainMenu() }
    );

  } else if (data === 'add_help') {
    bot.sendMessage(chatId,
      `➕ *Add Server:*\n\`/addserver <name> <ip> <port>\`\n\nExample:\n\`/addserver MySurvival 0.tcp.eu.ngrok.io 12345\`\n\nIP & Port → Aternos → Connect tab`,
      { parse_mode: 'Markdown' }
    );

  } else if (data === 'remove_help') {
    bot.editMessageText('🗑️ *Select server to remove:*', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: serversMenu() });

  } else if (data.startsWith('srv_')) {
    const srvId  = data.slice(4);
    const srv    = loadServers().find(s => s.id === srvId);
    if (!srv) { bot.editMessageText('❌ Not found.', { chat_id: chatId, message_id: msgId }); return; }
    const on = activeBots.has(srvId);
    bot.editMessageText(
      `🖥️ *${srv.name}*\n━━━━━━━━━━━━━━\n📡 \`${srv.host}:${srv.port}\`\n⚡ ${on ? '🟢 Online' : '🔴 Offline'}\n👤 Added by: ${srv.addedBy || 'N/A'}`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: serverActions(srvId, srv.name) }
    );

  } else if (data.startsWith('start_')) {
    const srvId = data.slice(6);
    const srv   = loadServers().find(s => s.id === srvId);
    if (!srv) return;
    joinServer(srv, chatId);
    bot.editMessageText(`▶️ *${srv.name}* starting...`, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: serverActions(srvId, srv.name)
    });

  } else if (data.startsWith('stop_')) {
    const srvId = data.slice(5);
    const srv   = loadServers().find(s => s.id === srvId);
    if (!srv) return;
    stopServer(srvId);
    bot.editMessageText(`⏹️ *${srv.name}* stopped.`, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: serverActions(srvId, srv.name)
    });

  } else if (data.startsWith('info_')) {
    const srvId = data.slice(5);
    const srv   = loadServers().find(s => s.id === srvId);
    if (!srv) return;
    const on = activeBots.has(srvId);
    bot.editMessageText(
      `📊 *${srv.name}*\n━━━━━━━━━━━━━━\n${on ? '🟢 Online' : '🔴 Offline'}\n📡 \`${srv.host}:${srv.port}\`\n🛡️ Anti-kick: ${on ? '✅ Active' : '❌ Inactive'}`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: serverActions(srvId, srv.name) }
    );

  } else if (data.startsWith('del_')) {
    const srvId  = data.slice(4);
    let servers  = loadServers();
    const srv    = servers.find(s => s.id === srvId);
    if (!srv) return;
    stopServer(srvId);
    saveServers(servers.filter(s => s.id !== srvId));
    bot.editMessageText(`🗑️ *${srv.name}* removed.`, {
      chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: mainMenu()
    });
  }
});

console.log('🚀 SHUVO_WOE72 v3.0 started!');
console.log(`👾 ${accounts.length} accounts | Anti-kick ON | Buttons UI`);
