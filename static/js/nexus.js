/* ==========================================================================
   NEXLINK — nexus.js
   The Nexus dashboard, wired to the real NEXLINK backend.
   Data comes from window.PulseAPI / window.PulseSocket and window.NEXUS_BOOT.
   ========================================================================== */
(function () {
    'use strict';

    var BOOT = window.NEXUS_BOOT || {};
    var API = window.PulseAPI;
    var Socket = window.PulseSocket;

    /* ---------- tiny helpers ---------- */
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function uid(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function pick(array) { return array[Math.floor(Math.random() * array.length)]; }
    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

    function initials(name) {
        var parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
        return parts.map(function (w) { return (w || '')[0]; }).join('').toUpperCase() || '?';
    }
    function hueColor(id) {
        return 'hsl(' + ((Number(id) * 137) % 360) + ', 62%, 52%)';
    }
    function fmtTime(iso) {
        var d = new Date(iso);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    function fmtShort(iso) {
        var d = new Date(iso);
        var now = new Date();
        if (d.toDateString() === now.toDateString()) return fmtTime(iso);
        var y = new Date(now); y.setDate(now.getDate() - 1);
        if (d.toDateString() === y.toDateString()) return 'Yesterday';
        var diff = (now - d) / 86400000;
        if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    function fmtDay(iso) {
        var d = new Date(iso);
        var now = new Date();
        if (d.toDateString() === now.toDateString()) return 'Today';
        var y = new Date(now); y.setDate(now.getDate() - 1);
        if (d.toDateString() === y.toDateString()) return 'Yesterday';
        return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    }
    function relTime(iso) {
        var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 60) return 'now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
    }

    /* ---------- state ---------- */
    var State = {
        me: BOOT.me || null,
        users: {},              // id -> user cache from API payloads
        chats: [],              // normalized conversations
        activeChatId: null,
        filter: 'all',
        replyTo: null,
        editingId: null,
        pendingAttachments: [],
        typing: {},             // chatId -> {userId, name}
        messagesLoaded: {},     // chatId -> bool
        notifications: [],
        prefs: (BOOT.me && BOOT.me.preferences) || {},
    };

    function cacheUser(user) {
        if (!user || user.id == null) return;
        var existing = State.users[user.id] || {};
        State.users[user.id] = Object.assign({}, existing, user);
    }

    function storeGet(key, fallback) {
        try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
        catch (e) { return fallback; }
    }
    function storeSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }

    /* ---------- theme + accent ---------- */
    function applyTheme(theme) {
        var resolved = theme;
        if (theme === 'system') {
            resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
        }
        document.documentElement.setAttribute('data-theme', resolved || 'dark');
        var meta = $('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', resolved === 'light' ? '#f7f4ee' : '#0a0912');
        var icon = $('#themeIconQuick');
        if (icon) {
            icon.innerHTML = resolved === 'dark'
                ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
                : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
        }
        State.prefs.theme = theme;
        storeSet('nexus.theme', theme);
    }
    function applyAccent(hex) {
        if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return;
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-h', shade(hex, -20));
        document.documentElement.style.setProperty('--accent-2', shade(hex, 25));
        var rgb = hexToRgb(hex);
        document.documentElement.style.setProperty('--accent-sub', 'rgba(' + rgb + ',.16)');
        document.documentElement.style.setProperty('--accent-soft', 'rgba(' + rgb + ',.08)');
        document.documentElement.style.setProperty('--accent-glow', 'rgba(' + rgb + ',.42)');
        State.prefs.accent = hex;
        storeSet('nexus.accent', hex);
    }
    function hexToRgb(hex) {
        var c = hex.replace('#', '');
        return parseInt(c.substr(0, 2), 16) + ',' + parseInt(c.substr(2, 2), 16) + ',' + parseInt(c.substr(4, 2), 16);
    }
    function shade(hex, amount) {
        var c = hex.replace('#', '');
        function f(v) {
            var out = clamp(Math.round(v + amount * 2.55), 0, 255);
            return ('0' + out.toString(16)).slice(-2);
        }
        return '#' + f(parseInt(c.substr(0, 2), 16)) + f(parseInt(c.substr(2, 2), 16)) + f(parseInt(c.substr(4, 2), 16));
    }

    /* ---------- toasts / menus ---------- */
    function toast(message) {
        var el = document.createElement('div');
        el.className = 'toast';
        el.textContent = message;
        $('#toastRoot').appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            el.style.transition = 'opacity .22s';
            setTimeout(function () { el.remove(); }, 240);
        }, 2400);
    }

    var openMenu = null;
    function closeMenus() {
        if (openMenu) { openMenu.remove(); openMenu = null; }
        $all('.menu').forEach(function (m) { m.remove(); });
    }
    function showMenu(items, x, y) {
        closeMenus();
        var menu = document.createElement('div');
        menu.className = 'menu';
        menu.innerHTML = items.map(function (item, i) {
            if (item.sep) return '<div class="menu-sep"></div>';
            return '<button class="menu-item ' + (item.danger ? 'danger' : '') + '" data-idx="' + i + '">' +
                (item.icon || '') + '<span>' + esc(item.label) + '</span></button>';
        }).join('');
        $('#menuRoot').appendChild(menu);
        openMenu = menu;
        var rect = menu.getBoundingClientRect();
        menu.style.left = clamp(x, 8, window.innerWidth - rect.width - 8) + 'px';
        menu.style.top = clamp(y, 8, window.innerHeight - rect.height - 8) + 'px';
        menu.addEventListener('click', function (e) {
            var btn = e.target.closest('.menu-item');
            if (!btn) return;
            var item = items[Number(btn.dataset.idx)];
            closeMenus();
            if (item && item.onClick) item.onClick();
        });
    }
    document.addEventListener('click', function (e) {
        if (openMenu && !openMenu.contains(e.target)) closeMenus();
    });

    /* ---------- avatars ---------- */
    function avatarStyle(user) {
        if (user && user.avatar_url) return 'background-image:url(\'' + user.avatar_url + '\')';
        return 'background:' + hueColor(user && user.id);
    }
    function avatarHtml(user, size, opts) {
        opts = opts || {};
        var cls = 'avatar ' + (size || '');
        var presence = (opts.presence && user && user.is_online)
            ? '<span class="presence"' + (opts.presenceBorder ? ' style="border-color:' + opts.presenceBorder + '"' : '') + '></span>'
            : '';
        var inner = (user && user.avatar_url) ? '' : esc(initials(user && user.display_name));
        return '<div class="' + cls + '" data-uid="' + (user ? user.id : '') + '" style="' + avatarStyle(user) + '">' + inner + presence + '</div>';
    }
    function senderAvatarHtml(user) {
        if (!user) return '';
        return '<div class="msg-sender" data-uid="' + user.id + '" style="' + avatarStyle(user) + '">' +
            (user.avatar_url ? '' : esc(initials(user.display_name))) + '</div>';
    }
    function groupAvatarHtml(group, size) {
        var members = (group && group.participants || []).slice(0, 4);
        var cells = [0, 1, 2, 3].map(function (i) {
            var member = members[i];
            if (!member) return '<i style="background:var(--bg-hover)"></i>';
            var user = State.users[member.id] || member;
            if (user.avatar_url) return '<i style="background-image:url(\'' + user.avatar_url + '\')"></i>';
            return '<i style="background:' + hueColor(user.id) + '">' + esc(initials(user.display_name)) + '</i>';
        }).join('');
        return '<div class="group-avatar ' + (size || '') + '">' + cells + '</div>';
    }

    /* ============================================================
       DATA LAYER (real API)
       ============================================================ */
    function normalizeConversation(raw) {
        (raw.participants || []).forEach(cacheUser);
        var others = (raw.participants || []).filter(function (p) { return p.id !== State.me.id; });
        var peer = raw.kind === 'group' ? null : (others[0] || null);
        return {
            id: raw.id,
            kind: raw.kind,
            name: raw.kind === 'group' ? raw.name : (peer ? peer.display_name : 'Conversation'),
            peer: peer,
            participants: raw.participants || [],
            description: raw.description || '',
            lastMessage: raw.last_message || null,
            unread: raw.unread_count || 0,
            pinned: !!raw.pinned,
            muted: !!raw.muted,
            archived: !!raw.archived,
            updatedAt: raw.updated_at,
            messages: [],
            fullyLoaded: false,
        };
    }

    function loadConversations() {
        return API.get('/api/conversations/').then(function (data) {
            var items = data && (data.results || data) || [];
            State.chats = items.map(normalizeConversation);
            renderConvList();
            renderNotificationsBadge();
            return State.chats;
        }).catch(function (err) {
            toast('Could not load conversations');
            console.error(err);
            return [];
        });
    }

    function loadMessages(chatId) {
        var chat = findChat(chatId);
        if (!chat || chat.fullyLoaded) return Promise.resolve();
        return API.get('/api/conversations/' + chatId + '/messages/').then(function (data) {
            var results = (data && data.results) || [];
            chat.messages = results.map(normalizeMessage).reverse().concat(chat.messages);
            if (!data.has_more) chat.fullyLoaded = true;
            State.messagesLoaded[chatId] = true;
            renderMessages();
        }).catch(function () {
            toast('Could not load messages');
        });
    }

    function normalizeMessage(raw) {
        cacheUser(raw.sender);
        return {
            id: raw.id,
            chatId: raw.conversation,
            from: raw.sender.id,
            sender: raw.sender,
            text: raw.is_deleted ? '' : (raw.body || ''),
            deleted: !!raw.is_deleted,
            edited: !!raw.edited_at,
            attachment: raw.attachment_url ? {
                kind: raw.message_type,
                name: raw.attachment_name,
                size: raw.attachment_size,
                url: raw.attachment_url,
            } : null,
            replyTo: raw.reply_to,
            state: raw.state,
            starred: !!raw.starred,
            pinned: !!raw.pinned,
            reactions: raw.reactions || [],
            ts: raw.created_at,
        };
    }

    function findChat(chatId) {
        return State.chats.find(function (c) { return String(c.id) === String(chatId); });
    }
    function activeChat() { return State.chats.find(function (c) { return c.id === State.activeChatId; }); }
    function findMessage(chatId, messageId) {
        var chat = findChat(chatId);
        if (!chat) return null;
        return chat.messages.find(function (m) { return String(m.id) === String(messageId); });
    }

    /* ---------- realtime ---------- */
    function connectSockets() {
        Socket.on('message.new', function (event) {
            var payload = event.message;
            if (!payload) return;
            var chat = findChat(payload.conversation);
            if (!chat) { loadConversations().then(function () { return loadMessages(payload.conversation); }); return; }
            if (payload.sender.id === State.me.id) return;
            var existing = findMessage(chat.id, payload.id);
            if (existing) return;
            chat.messages.push(normalizeMessage(payload));
            chat.lastMessage = { id: payload.id, body: payload.body, sender_id: payload.sender.id, created_at: payload.created_at };
            if (State.activeChatId === chat.id) { renderMessages(); } else { chat.unread += 1; }
            renderConvList();
            if (!chat.muted && State.prefs.notifications !== false) {
                toast(payload.sender.display_name.split(' ')[0] + ': ' + ((payload.body || 'New message').slice(0, 60)));
            }
        });
        Socket.on('typing.event', function (event) {
            if (event.user_id === State.me.id) return;
            var chat = findChat(event.conversation_id);
            if (!chat) return;
            if (event.is_typing) {
                State.typing[chat.id] = event.display_name;
                toastlessTyping(chat.id);
            } else {
                delete State.typing[chat.id];
            }
            renderConvList();
            if (State.activeChatId === chat.id) renderChatHeader();
        });
        Socket.on('read.event', function (event) {
            if (event.user_id === State.me.id) return;
            var chat = findChat(event.conversation_id);
            if (!chat) return;
            chat.messages.forEach(function (m) {
                if (m.from === State.me.id) m.state = 'read';
            });
            if (State.activeChatId === chat.id) renderMessages();
        });
        Socket.on('presence.event', function (event) {
            var user = State.users[event.user_id];
            if (!user) return;
            user.is_online = event.is_online;
            var chat = State.chats.find(function (c) { return c.peer && c.peer.id === event.user_id; });
            if (chat && State.activeChatId === chat.id) renderChatHeader();
            renderConvList();
        });
        Socket.on('reaction.updated', function (event) {
            var message = findMessage(event.conversation_id, event.message_id);
            if (!message) return;
            API.get('/api/conversations/' + event.conversation_id + '/messages/?before=' + message.id).catch(function () {});
            toast((event.added ? 'Reaction added' : 'Reaction removed'));
            refreshMessages(event.conversation_id);
        });
        Socket.on('message.edited', function (event) {
            var message = findMessage(event.conversation_id, event.message_id);
            if (!message) return;
            message.text = event.body;
            message.edited = true;
            if (State.activeChatId === event.conversation_id) renderMessages();
        });
        Socket.on('message.deleted', function (event) {
            var message = findMessage(event.conversation_id, event.message_id);
            if (!message) return;
            message.deleted = true;
            message.text = '';
            if (State.activeChatId === event.conversation_id) renderMessages();
        });

        Socket.connectUser();
        Socket.on('conversation.new', function (event) {
            loadConversations();
            if (event.notification && State.prefs.notifications !== false) {
                State.notifications.unshift({
                    id: uid('n'), kind: 'message',
                    text: (event.sender && event.sender.display_name || 'Someone') + ' sent you a message.',
                    conversation_id: event.conversation_id,
                    created_at: new Date().toISOString(), read: false,
                });
                renderNotificationsBadge();
            }
        });
        Socket.on('notification.event', function (event) {
            var n = event.notification;
            if (!n) return;
            State.notifications.unshift({
                id: uid('n'), kind: n.kind || 'message',
                text: n.text || 'New activity',
                conversation_id: n.conversation_id,
                created_at: new Date().toISOString(), read: false,
            });
            renderNotificationsBadge();
        });
    }
    var typingToastShown = {};
    function toastlessTyping(chatId) {
        typingToastShown[chatId] = true;
    }

    function refreshMessages(chatId) {
        var chat = findChat(chatId);
        if (!chat) return;
        API.get('/api/conversations/' + chatId + '/messages/').then(function (data) {
            chat.messages = ((data && data.results) || []).map(normalizeMessage);
            renderMessages();
        }).catch(function () { /* ignore */ });
    }

    /* ============================================================
       RENDER: conversation list
       ============================================================ */
    function renderConvList() {
        var query = ($('#convSearch').value || '').trim().toLowerCase();
        var listEl = $('#convList');
        var items = State.chats.filter(function (c) {
            if (State.filter === 'archived') return c.archived;
            if (c.archived) return false;
            if (State.filter === 'unread' && !c.unread) return false;
            if (State.filter === 'pinned' && !c.pinned) return false;
            if (State.filter === 'groups' && c.kind !== 'group') return false;
            return true;
        });
        if (query) {
            items = items.filter(function (c) {
                var name = c.kind === 'group' ? c.name : (c.peer ? c.peer.display_name : '');
                var last = c.lastMessage && c.lastMessage.body || '';
                return (name || '').toLowerCase().includes(query) || last.toLowerCase().includes(query);
            });
        }
        items.sort(function (a, b) {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            var ta = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : new Date(a.updatedAt).getTime();
            var tb = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : new Date(b.updatedAt).getTime();
            return tb - ta;
        });

        var unreadTotal = State.chats.filter(function (c) { return c.unread && !c.archived; }).length;
        $('#unreadCount').textContent = unreadTotal || '';
        $('#sidebarCount').textContent = State.chats.filter(function (c) { return !c.archived; }).length;

        if (!items.length) {
            var headings = {
                archived: ['No archived chats', 'Archived conversations will appear here.'],
                groups: ['No groups yet', 'Create a group to chat with multiple people.'],
                pinned: ['No pinned chats', 'Pin a conversation to keep it on top.'],
                unread: ['All caught up', 'No unread messages right now.'],
            };
            var heading = headings[State.filter] || ['No conversations', 'Start a conversation to see it here.'];
            listEl.innerHTML = '<div class="chat-empty" style="padding:48px 20px"><h3 style="font-size:15px">' + heading[0] + '</h3><p style="font-size:13px">' + heading[1] + '</p></div>';
            return;
        }

        listEl.innerHTML = items.map(function (c) {
            var isGroup = c.kind === 'group';
            var last = c.lastMessage;
            var preview = 'Say hello 👋';
            if (State.typing[c.id]) preview = '<span class="typing">typing…</span>';
            else if (last) {
                var body = last.is_deleted ? 'Message deleted' : (last.body || '');
                var prefix = '';
                if (last.sender_id === State.me.id) prefix = 'You: ';
                else if (isGroup) {
                    var sender = State.users[last.sender_id];
                    prefix = sender ? sender.display_name.split(' ')[0] + ': ' : '';
                }
                preview = prefix + esc(body.slice(0, 80));
            }
            var time = last ? fmtShort(last.created_at) : '';
            var avatarMarkup = isGroup
                ? groupAvatarHtml({ participants: c.participants }, '')
                : avatarHtml(c.peer, '', { presence: true });
            var verified = (!isGroup && c.peer && c.peer.verified)
                ? '<span class="verified">' + ICONS.check + '</span>' : '';
            var badge = c.unread ? '<span class="badge">' + (c.unread > 99 ? '99+' : c.unread) + '</span>' : '';
            var icons = [];
            if (c.muted) icons.push('<span style="color:var(--text-3)">' + ICONS.bellOff + '</span>');
            if (last && last.sender_id === State.me.id && last.state) {
                icons.push('<span style="color:' + (last.state === 'read' ? 'var(--accent)' : 'var(--text-3)') + '">' +
                    (last.state === 'read' ? ICONS.checkDouble : ICONS.check) + '</span>');
            }
            return '<div class="conv ' + (String(c.id) === String(State.activeChatId) ? 'active' : '') +
                (c.unread ? ' unread' : '') + '" data-id="' + c.id + '">' +
                avatarMarkup +
                '<div class="conv-body"><div class="conv-top"><span class="conv-name">' + esc(c.name) + verified +
                (isGroup ? '<span class="grp-tag">' + c.participants.length + '</span>' : '') +
                '</span></div><div class="conv-preview">' + preview + '</div></div>' +
                '<div class="conv-meta"><span class="conv-time">' + time + '</span>' +
                (badge || (icons.length ? '<span class="conv-icons">' + icons.join('') + '</span>' : '')) +
                '</div></div>';
        }).join('');
    }

    /* ============================================================
       RENDER: chat area
       ============================================================ */
    function showEmptyChat() {
        $('#chatEmpty').classList.remove('hidden');
        $('#chatHead').classList.add('hidden');
        $('#messages').classList.add('hidden');
        $('#composerWrap').classList.add('hidden');
        $('#pinnedBanner').innerHTML = '';
        document.getElementById('app').classList.remove('chat-open');
    }

    function openChat(chatId) {
        var chat = findChat(chatId);
        if (!chat) return;
        State.activeChatId = chat.id;
        $('#chatEmpty').classList.add('hidden');
        $('#chatHead').classList.remove('hidden');
        $('#messages').classList.remove('hidden');
        $('#composerWrap').classList.remove('hidden');
        renderChatHeader();
        renderPinnedBanner();
        if (!State.messagesLoaded[chat.id]) {
            loadMessages(chat.id);
        } else {
            renderMessages();
        }
        renderConvList();
        API.post('/api/conversations/' + chat.id + '/read/').catch(function () { /* ignore */ });
        chat.unread = 0;
        Socket.connect(chat.id);
        if (window.innerWidth <= 900) document.getElementById('app').classList.add('chat-open');
        setTimeout(function () { if (window.innerWidth > 600) $('#msgInput').focus(); }, 120);
    }

    function renderChatHeader() {
        var chat = activeChat();
        if (!chat) return;
        var slot = $('#chatHeadAvatarSlot');
        var isGroup = chat.kind === 'group';
        slot.innerHTML = isGroup
            ? groupAvatarHtml({ participants: chat.participants }, 'sm')
            : avatarHtml(chat.peer, '', { presence: true, presenceBorder: 'var(--bg-chat)' });
        if (isGroup) {
            $('#chatHeadName').textContent = chat.name;
            var status = $('#chatHeadStatus');
            if (State.typing[chat.id]) { status.className = 'chat-head-status typing'; status.textContent = 'typing…'; }
            else { status.className = 'chat-head-status'; status.textContent = chat.participants.length + ' members'; }
        } else {
            var peer = State.users[chat.peer.id] || chat.peer;
            $('#chatHeadName').textContent = peer.display_name;
            var status2 = $('#chatHeadStatus');
            if (State.typing[chat.id]) { status2.className = 'chat-head-status typing'; status2.textContent = 'typing…'; }
            else if (peer.is_online) { status2.className = 'chat-head-status online'; status2.innerHTML = '<span class="dot"></span>Online'; }
            else { status2.className = 'chat-head-status'; status2.textContent = 'Offline'; }
        }
    }

    function renderPinnedBanner() {
        var chat = activeChat();
        var banner = $('#pinnedBanner');
        if (!chat) { banner.innerHTML = ''; return; }
        var pinned = chat.messages.filter(function (m) { return m.pinned && !m.deleted; });
        if (!pinned.length) { banner.innerHTML = ''; return; }
        var latest = pinned[pinned.length - 1];
        banner.innerHTML = '<div class="pinned-banner">' + ICONS.pin +
            '<div class="text"><strong>Pinned:</strong> ' + esc((latest.text || '').slice(0, 90)) + '</div>' +
            '<button class="icon-btn" style="width:26px;height:26px" id="pinnedClose">' + ICONS.x + '</button></div>';
        $('#pinnedClose').addEventListener('click', function () {
            API.post('/api/messages/' + latest.id + '/pin/').then(function (data) {
                latest.pinned = !!data.pinned;
                renderPinnedBanner();
                renderMessages();
            }).catch(function () {});
        });
    }

    function renderMessages() {
        var chat = activeChat();
        var box = $('#messages');
        if (!chat) { box.innerHTML = ''; return; }
        var html = '';
        var lastDay = '';
        chat.messages.forEach(function (m, index) {
            var dayKey = new Date(m.ts).toDateString();
            if (dayKey !== lastDay) {
                lastDay = dayKey;
                html += '<div class="msg-day">' + fmtDay(m.ts) + '</div>';
            }
            var prev = chat.messages[index - 1];
            var isFirst = !prev || prev.from !== m.from ||
                (new Date(m.ts) - new Date(prev.ts)) > 5 * 60000;
            var isSameSender = prev && prev.from === m.from &&
                (new Date(m.ts) - new Date(prev.ts)) <= 5 * 60000;
            html += renderMessage(m, isFirst, isSameSender, chat);
        });
        if (State.typing[chat.id]) {
            html += '<div class="typing-row"><div class="typing-bubble"><i></i><i></i><i></i></div></div>';
        }
        box.innerHTML = html;
        requestAnimationFrame(function () { box.scrollTop = box.scrollHeight; });
    }

    function renderMessage(m, isFirst, isSameSender, chat) {
        var mine = m.from === State.me.id;
        var isGroup = chat.kind === 'group';
        var sender = State.users[m.from] || m.sender || { display_name: 'Unknown' };
        var senderAvatar = '';
        if (!mine) {
            senderAvatar = isSameSender
                ? '<div class="msg-sender hidden-sender"></div>'
                : senderAvatarHtml(sender);
        }
        var inner = '';
        if (m.replyTo) {
            inner += '<div class="reply-quote"><strong>' + esc(m.replyTo.sender_name) + '</strong>' +
                '<span>' + esc((m.replyTo.body || 'Attachment').slice(0, 80)) + '</span></div>';
        }
        if (m.deleted) {
            inner += '<em style="opacity:.7">This message was deleted</em>';
        } else if (m.attachment) {
            if (m.attachment.kind === 'image') {
                inner += '<div class="attach-img"><img src="' + esc(m.attachment.url) + '" alt="" loading="lazy"></div>';
            } else if (m.attachment.kind === 'audio') {
                inner += '<audio controls src="' + esc(m.attachment.url) + '" style="max-width:240px;height:36px"></audio>';
            } else {
                inner += '<div class="attach-file">' + ICONS.file +
                    '<div class="meta"><div class="name">' + esc(m.attachment.name || 'File') + '</div>' +
                    '<div class="size">' + esc(fmtBytes(m.attachment.size)) + '</div></div></div>';
            }
        }
        if (m.text) {
            inner += '<span class="' + (m.edited ? 'edited' : '') + '">' + esc(m.text) + '</span>';
        }
        var reactionsHtml = '';
        if (m.reactions && m.reactions.length) {
            reactionsHtml = '<div class="reactions">' + m.reactions.map(function (r) {
                var mineReaction = (r.users || []).indexOf(State.me.id) !== -1;
                return '<button class="reaction ' + (mineReaction ? 'mine' : '') + '" data-react="' + esc(r.emoji) + '">' +
                    '<span>' + esc(r.emoji) + '</span><span class="count">' + r.count + '</span></button>';
            }).join('') + '</div>';
        }
        var status = mine ? statusIcon(m.state) : '';
        var starIcon = m.starred ? '<span class="starred">' + ICONS.starFill + '</span>' : '';
        var pinIcon = m.pinned ? '<span style="color:var(--accent)">' + ICONS.pin + '</span>' : '';
        return '<div class="msg-row ' + (mine ? 'out' : 'in') + (isFirst ? ' first' : '') + '" data-msg-id="' + m.id + '">' +
            senderAvatar +
            '<div class="msg-content"><div class="bubble">' + inner + '</div>' +
            reactionsHtml +
            '<div class="msg-meta">' + starIcon + pinIcon + '<span>' + fmtTime(m.ts) + '</span>' +
            (status ? '<span class="status ' + (m.state === 'read' ? 'read' : '') + '">' + status + '</span>' : '') +
            '</div><div class="msg-actions">' +
            '<button data-action="react" title="React">' + ICONS.heart + '</button>' +
            '<button data-action="reply" title="Reply">' + ICONS.reply + '</button>' +
            '<button data-action="star" title="Star">' + (m.starred ? ICONS.starFill : ICONS.star) + '</button>' +
            '<button data-action="more" title="More">' + ICONS.more + '</button>' +
            '</div></div></div>';
    }

    function statusIcon(state) {
        if (state === 'read') return ICONS.checkDouble;
        if (state === 'delivered') return ICONS.checkDouble;
        if (state === 'sent') return ICONS.check;
        return '';
    }
    function fmtBytes(b) {
        b = Number(b || 0);
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }

    var ICONS = {
        reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
        heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
        copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
        edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
        pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.5-4.5a2 2 0 0 1 .6-2.2L19 9l-7-6-7 6 1 1.3a2 2 0 0 1 .6 2.2L5 17z"/></svg>',
        star: '<svg viewBox="0 0 24 24" fill="none" star-width="1.9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        starFill: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        checkDouble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 6 8 17 2 11"/><polyline points="22 6 12 17 9 14"/></svg>',
        bellOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
        file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        userPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
        users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
        block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    };

    /* ---------- messages interactions ---------- */
    $('#messages').addEventListener('click', function (e) {
        var reaction = e.target.closest('.reaction[data-react]');
        if (reaction) {
            var row = reaction.closest('.msg-row');
            API.post('/api/messages/' + row.dataset.msgId + '/react/', { emoji: reaction.dataset.react })
                .then(function () { refreshMessages(State.activeChatId); })
                .catch(function (err) { toast(err.message || 'Could not react'); });
            return;
        }
        var action = e.target.closest('.msg-actions button');
        if (action) {
            var msgRow = action.closest('.msg-row');
            var message = findMessage(State.activeChatId, msgRow.dataset.msgId);
            if (message) handleMsgAction(action.dataset.action, message, action);
        }
    });

    function handleMsgAction(action, m, btn) {
        var mine = m.from === State.me.id;
        if (action === 'reply') { setReplyTo(m); return; }
        if (action === 'star') {
            API.post('/api/messages/' + m.id + '/star/').then(function (data) {
                m.starred = !!data.starred;
                renderMessages();
                toast(m.starred ? 'Starred' : 'Unstarred');
            }).catch(function () {});
            return;
        }
        if (action === 'copy') {
            navigator.clipboard && navigator.clipboard.writeText(m.text || '');
            toast('Copied to clipboard');
            return;
        }
        if (action === 'react') { showReactionPicker(btn, m); return; }
        if (action === 'more') {
            var rect = btn.getBoundingClientRect();
            showMessageMenu(m, rect.left, rect.bottom + 6);
        }
    }

    function showReactionPicker(btn, m) {
        var rect = btn.getBoundingClientRect();
        showMenu(['❤️', '😂', '👍', '😮', '😢', '🔥'].map(function (emoji) {
            return { label: emoji, onClick: function () {
                API.post('/api/messages/' + m.id + '/react/', { emoji: emoji })
                    .then(function () { refreshMessages(State.activeChatId); })
                    .catch(function (err) { toast(err.message || 'Could not react'); });
            } };
        }), rect.left, rect.bottom + 6);
    }

    function showMessageMenu(m, x, y) {
        var chat = activeChat();
        var items = [
            { label: 'Reply', icon: ICONS.reply, onClick: function () { setReplyTo(m); } },
            { label: m.starred ? 'Unstar' : 'Star', icon: m.starred ? ICONS.starFill : ICONS.star, onClick: function () {
                API.post('/api/messages/' + m.id + '/star/').then(function (data) {
                    m.starred = !!data.starred; renderMessages();
                }).catch(function () {});
            } },
            { label: m.pinned ? 'Unpin' : 'Pin', icon: ICONS.pin, onClick: function () {
                API.post('/api/messages/' + m.id + '/pin/').then(function (data) {
                    m.pinned = !!data.pinned;
                    renderMessages(); renderPinnedBanner();
                }).catch(function () {});
            } },
            { label: 'Copy text', icon: ICONS.copy, onClick: function () {
                navigator.clipboard && navigator.clipboard.writeText(m.text || '');
                toast('Copied');
            } },
        ];
        if (mine) {
            items.push({ sep: true });
            items.push({ label: 'Edit', icon: ICONS.edit, onClick: function () { startEdit(m); } });
            items.push({ label: 'Delete', icon: ICONS.trash, danger: true, onClick: function () {
                API.delete('/api/messages/' + m.id + '/delete/').then(function () {
                    m.deleted = true; m.text = '';
                    renderMessages(); renderConvList();
                }).catch(function (err) { toast(err.message || 'Could not delete'); });
            } });
        }
        showMenu(items, x, y);
    }

    function setReplyTo(m) {
        State.replyTo = m;
        renderReplyBar();
        $('#msgInput').focus();
    }
    function renderReplyBar() {
        var el = $('#replyBar');
        if (!State.replyTo) { el.innerHTML = ''; return; }
        var author = State.replyTo.from === State.me.id
            ? 'You'
            : ((State.users[State.replyTo.from] || {}).display_name || '').split(' ')[0];
        el.innerHTML = '<div class="reply-bar"><div class="reply-preview"><div class="meta">' +
            '<strong>Replying to ' + esc(author) + '</strong>' +
            '<span>' + esc((State.replyTo.text || '').slice(0, 90)) + '</span></div></div>' +
            '<button class="icon-btn" id="cancelReply">' + ICONS.x + '</button></div>';
        $('#cancelReply').addEventListener('click', function () {
            State.replyTo = null;
            renderReplyBar();
        });
    }
    function startEdit(m) {
        State.editingId = m.id;
        $('#msgInput').value = m.text;
        autoGrow($('#msgInput'));
        updateSendState();
        $('#msgInput').focus();
    }
    function cancelEdit() {
        State.editingId = null;
        $('#msgInput').value = '';
        autoGrow($('#msgInput'));
        updateSendState();
    }

    /* ---------- composer ---------- */
    function autoGrow(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 140) + 'px';
    }
    function updateSendState() {
        $('#btnSend').disabled = !$('#msgInput').value.trim() && !State.pendingAttachments.length;
    }
    $('#msgInput').addEventListener('input', function () {
        autoGrow(this);
        updateSendState();
        var chat = activeChat();
        if (chat && Socket.send({ type: 'typing', is_typing: true })) {
            clearTimeout(State._typingTimer);
            State._typingTimer = setTimeout(function () {
                Socket.send({ type: 'typing', is_typing: false });
            }, 2500);
        }
    });
    $('#msgInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && State.prefs.enter_to_send !== false) {
            e.preventDefault();
            sendMessage();
        }
    });
    $('#btnSend').addEventListener('click', sendMessage);

    function sendMessage() {
        var chat = activeChat();
        if (!chat) return;
        var text = $('#msgInput').value.trim();
        if (State.editingId) {
            var editing = findMessage(chat.id, State.editingId);
            if (editing && text) {
                API.patch('/api/messages/' + editing.id + '/edit/', { body: text }).then(function () {
                    editing.text = text; editing.edited = true;
                    renderMessages(); renderConvList();
                }).catch(function (err) { toast(err.message || 'Could not edit'); });
            }
            cancelEdit();
            return;
        }
        if (!text && !State.pendingAttachments.length) return;
        var payload = { body: text };
        if (State.replyTo) payload.reply_to = State.replyTo.id;
        var send = State.pendingAttachments.length
            ? sendWithAttachment(chat, text)
            : API.post('/api/conversations/' + chat.id + '/messages/', payload);

        Promise.resolve(send).then(function (created) {
            if (created && created.id) {
                chat.messages.push(normalizeMessage(created));
                chat.lastMessage = { id: created.id, sender_id: State.me.id, body: created.body, created_at: created.created_at, state: created.state };
            }
            State.replyTo = null;
            renderReplyBar();
            renderMessages();
            renderConvList();
        }).catch(function (err) {
            toast(err.message || 'Could not send');
        });
        $('#msgInput').value = '';
        autoGrow($('#msgInput'));
        updateSendState();
    }

    function sendWithAttachment(chat, text) {
        var attachment = State.pendingAttachments[0];
        State.pendingAttachments = [];
        var form = new FormData();
        form.append('body', text || ' ');
        form.append('message_type', attachment.kind);
        form.append('attachment', attachment.file);
        if (State.replyTo) form.append('reply_to', State.replyTo.id);
        return API.post('/api/conversations/' + chat.id + '/messages/', form);
    }

    /* ---------- attachments ---------- */
    $('#btnAttach').addEventListener('click', function (e) {
        var rect = e.currentTarget.getBoundingClientRect();
        showMenu([
            { label: 'Photos', icon: '', onClick: function () { pickFile('image/*', 'image'); } },
            { label: 'Video', icon: '', onClick: function () { pickFile('video/*', 'video'); } },
            { label: 'Document', icon: '', onClick: function () { pickFile('*/*', 'file'); } },
            { label: 'Audio', icon: '', onClick: function () { pickFile('audio/*', 'audio'); } },
        ], rect.left, rect.top - 8);
    });
    function pickFile(accept, kind) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.addEventListener('change', function () {
            var file = input.files[0];
            if (!file) return;
            if (file.size > 25 * 1024 * 1024) { toast('File too large (max 25 MB)'); return; }
            State.pendingAttachments = [{ kind: kind, file: file, name: file.name }];
            updateSendState();
            toast('Attached: ' + file.name);
        });
        input.click();
    }

    /* ---------- chat header actions ---------- */
    $('#chatBack').addEventListener('click', function () {
        document.getElementById('app').classList.remove('chat-open');
        State.activeChatId = null;
        showEmptyChat();
        renderConvList();
    });
    $('#chatHeadInfo').addEventListener('click', openInfoPanel);
    $('#btnChatMore').addEventListener('click', function (e) {
        var chat = activeChat();
        if (!chat) return;
        var isGroup = chat.kind === 'group';
        var rect = e.currentTarget.getBoundingClientRect();
        var items = [
            { label: isGroup ? 'Group info' : 'Contact info', icon: ICONS.info, onClick: openInfoPanel },
            { label: chat.muted ? 'Unmute' : 'Mute notifications', onClick: function () {
                API.patch('/api/conversations/' + chat.id + '/state/', { muted: !chat.muted }).then(function () {
                    chat.muted = !chat.muted;
                    renderConvList(); openInfoPanel();
                }).catch(function () {});
            } },
            { label: chat.pinned ? 'Unpin chat' : 'Pin chat', onClick: function () {
                API.patch('/api/conversations/' + chat.id + '/state/', { pinned: !chat.pinned }).then(function () {
                    chat.pinned = !chat.pinned;
                    renderConvList();
                }).catch(function () {});
            } },
            { label: chat.archived ? 'Unarchive' : 'Archive', onClick: function () {
                API.patch('/api/conversations/' + chat.id + '/state/', { archived: !chat.archived }).then(function () {
                    chat.archived = !chat.archived;
                    renderConvList();
                    showEmptyChat();
                }).catch(function () {});
            } },
            { sep: true },
        ];
        if (isGroup) {
            items.push({ label: 'Add members', onClick: function () { addMembersToGroup(chat); } });
            items.push({ label: 'Leave group', danger: true, onClick: function () {
                API.post('/api/groups/' + chat.id + '/leave/').then(function () {
                    State.chats = State.chats.filter(function (c) { return c.id !== chat.id; });
                    showEmptyChat(); renderConvList();
                    toast('Left the group');
                }).catch(function (err) { toast(err.message || 'Could not leave'); });
            } });
        } else {
            items.push({ label: 'Clear chat', danger: true, onClick: function () {
                if (!confirm('Hide all messages in this chat for you?')) return;
                API.post('/api/conversations/' + chat.id + '/clear/').then(function () {
                    chat.messages = [];
                    renderMessages(); toast('Chat cleared');
                }).catch(function () {});
            } });
            items.push({ label: 'Block contact', danger: true, onClick: function () {
                API.post('/api/users/' + chat.peer.id + '/block/').then(function () {
                    toast('Contact blocked');
                }).catch(function () {});
            } });
        }
        showMenu(items, rect.right - 220, rect.bottom + 6);
    });
    $('#btnVoiceCall').addEventListener('click', function () {
        toast('Voice calls coming soon');
    });
    $('#btnVideoCall').addEventListener('click', function () {
        toast('Video calls coming soon');
    });
    $('#btnChatSearch').addEventListener('click', openGlobalSearch);

    /* ---------- info panel ---------- */
    function openInfoPanel() {
        var chat = activeChat();
        if (!chat) return;
        if (chat.kind === 'group') renderGroupInfo(chat);
        else renderContactInfo(chat);
        $('#infoPanel').classList.add('open');
    }
    $('#infoClose').addEventListener('click', function () {
        $('#infoPanel').classList.remove('open');
    });

    function renderContactInfo(chat) {
        var peer = State.users[chat.peer.id] || chat.peer;
        $('#infoTitle').textContent = 'Contact info';
        $('#infoBody').innerHTML =
            '<div class="info-profile">' + avatarHtml(peer, 'xl') +
            '<h4>' + esc(peer.display_name) + '</h4>' +
            '<div class="handle">' + esc(peer.about || '') + '</div>' +
            '<div class="status-badge ' + (peer.is_online ? 'online' : 'offline') + '">' +
            (peer.is_online ? 'Online' : 'Offline') + '</div></div>' +
            '<div class="info-section"><div class="info-list">' +
            '<button class="info-item" data-info-action="search">' + ICONS.search + '<span class="lbl">Search in conversation</span></button>' +
            '<button class="info-item" data-info-action="clear">' + ICONS.trash + '<span class="lbl">Clear chat</span></button>' +
            '<button class="info-item danger" data-info-action="block">' + ICONS.block + '<span class="lbl">Block contact</span></button>' +
            '</div></div>';
        $all('[data-info-action]').forEach(function (b) {
            b.addEventListener('click', function () {
                var a = b.dataset.infoAction;
                if (a === 'block') {
                    API.post('/api/users/' + peer.id + '/block/').then(function () { toast('Contact blocked'); }).catch(function () {});
                } else if (a === 'clear') {
                    API.post('/api/conversations/' + chat.id + '/clear/').then(function () {
                        chat.messages = []; renderMessages(); toast('Chat cleared');
                    }).catch(function () {});
                } else {
                    openGlobalSearch();
                }
            });
        });
    }

    function renderGroupInfo(chat) {
        var isAdmin = (chat.participants || []).some(function (p) {
            return p.id === State.me.id && p.is_admin;
        });
        $('#infoTitle').textContent = 'Group info';
        var memberRows = (chat.participants || []).map(function (p) {
            var user = State.users[p.id] || p;
            return '<div class="member-row">' + avatarHtml(user, 'sm', { presence: true }) +
                '<div class="meta"><div class="name">' + esc(p.display_name) +
                (p.is_admin ? '<span class="admin-tag">admin</span>' : '') +
                (p.id === State.me.id ? ' (you)' : '') +
                '</div></div></div>';
        }).join('');
        $('#infoBody').innerHTML =
            '<div class="info-profile">' + groupAvatarHtml({ participants: chat.participants }, 'xl') +
            '<h4>' + esc(chat.name) + '</h4>' +
            '<div class="handle">' + chat.participants.length + ' members</div>' +
            (chat.description ? '<div class="bio">' + esc(chat.description) + '</div>' : '') +
            '</div>' +
            '<div class="info-section"><div class="info-section-title">Members' +
            (isAdmin ? ' <button data-action="add-members">Add</button>' : '') + '</div>' +
            '<div class="info-list">' + memberRows + '</div></div>';
        var addBtn = $('[data-action="add-members"]');
        if (addBtn) addBtn.addEventListener('click', function () { addMembersToGroup(chat); });
    }

    function addMembersToGroup(chat) {
        API.get('/api/chats/people/').then(function (data) {
            var people = (data && (data.results || data)) || [];
            var inGroup = {};
            (chat.participants || []).forEach(function (p) { inGroup[p.id] = true; });
            var candidates = people.filter(function (p) { return !inGroup[p.id]; });
            if (!candidates.length) { toast('Everyone you know is already in this group'); return; }
            showMenu(candidates.slice(0, 8).map(function (person) {
                return { label: 'Add ' + person.display_name, onClick: function () {
                    API.post('/api/groups/' + chat.id + '/members/', { user_id: person.id }).then(function () {
                        toast('Member added');
                        return loadConversations().then(function () {
                            var fresh = findChat(chat.id);
                            if (fresh) renderGroupInfo(fresh);
                        });
                    }).catch(function (err) { toast(err.message || 'Could not add member'); });
                } };
            }), 80, 80);
        }).catch(function () { toast('Could not load people'); });
    }

    /* ---------- notifications ---------- */
    function openNotifications() {
        API.get('/api/notifications/').then(function (data) {
            State.notifications = ((data && (data.results || data)) || []).map(function (n) {
                return {
                    id: n.id, kind: n.kind, text: n.text,
                    conversation_id: n.conversation,
                    created_at: n.created_at, read: n.is_read,
                };
            });
            renderNotifications();
            $('#notifPanel').classList.add('open');
            API.post('/api/notifications/read/').then(renderNotificationsBadge).catch(function () {});
        }).catch(function () { toast('Could not load notifications'); });
    }
    function renderNotifications() {
        var body = $('#notifBody');
        if (!State.notifications.length) {
            body.innerHTML = '<div class="chat-empty" style="padding:60px 20px"><h3 style="font-size:15px">No notifications</h3><p style="font-size:13px">You\'re all caught up.</p></div>';
            return;
        }
        body.innerHTML = State.notifications.map(function (n) {
            return '<div class="notif ' + (n.read ? '' : 'unread') + '" data-id="' + n.id + '">' +
                '<div class="notif-icon">' + ICONS.more + '</div>' +
                '<div class="notif-body"><div class="notif-title">' + esc(n.text) + '</div>' +
                '<div class="notif-time">' + relTime(n.created_at) + '</div></div></div>';
        }).join('');
        $all('.notif').forEach(function (el) {
            el.addEventListener('click', function () {
                var n = State.notifications.find(function (x) { return String(x.id) === String(el.dataset.id); });
                if (n && n.conversation_id) {
                    $('#notifPanel').classList.remove('open');
                    openChat(n.conversation_id);
                }
            });
        });
    }
    function renderNotificationsBadge() {
        var unread = State.notifications.filter(function (n) { return !n.read; }).length;
        var dot = $('#railNotifDot');
        if (dot) dot.style.display = unread ? 'block' : 'none';
    }
    $('#railNotif').addEventListener('click', openNotifications);
    $('#notifClose').addEventListener('click', function () {
        $('#notifPanel').classList.remove('open');
    });
    $('#notifMarkAll').addEventListener('click', function () {
        API.post('/api/notifications/read/').then(function () {
            State.notifications.forEach(function (n) { n.read = true; });
            renderNotifications(); renderNotificationsBadge();
        }).catch(function () {});
    });

    /* ---------- global search ---------- */
    $('#btnGlobalSearch').addEventListener('click', openGlobalSearch);
    document.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openGlobalSearch();
        }
        if (e.key === 'Escape') closeMenus();
    });
    function openGlobalSearch() {
        var root = $('#modalRoot');
        root.innerHTML = '<div class="modal-back" id="searchBack" style="align-items:flex-start;padding-top:12vh">' +
            '<div class="modal" style="width:min(560px,100%)"><div class="modal-head" style="padding:12px 16px">' +
            ICONS.search +
            '<input id="globalSearchInput" placeholder="Search people…" style="flex:1;background:transparent;border:none;outline:none;font-size:15px;color:var(--text-1);font-family:inherit" />' +
            '<button class="icon-btn" id="searchClose">' + ICONS.x + '</button></div>' +
            '<div class="modal-body" id="searchResults" style="padding:8px"></div></div></div>';
        var close = function () { root.innerHTML = ''; };
        $('#searchClose').addEventListener('click', close);
        $('#searchBack').addEventListener('click', function (e) { if (e.target.id === 'searchBack') close(); });
        var input = $('#globalSearchInput');
        input.focus();
        input.addEventListener('input', function () {
            var q = input.value.trim();
            if (q.length < 2) { $('#searchResults').innerHTML = '<div style="padding:14px;color:var(--text-3);font-size:13px">Type at least 2 characters…</div>'; return; }
            API.get('/api/users/search/?q=' + encodeURIComponent(q)).then(function (data) {
                var results = (data && data.results) || [];
                $('#searchResults').innerHTML = results.length
                    ? results.map(function (u) {
                        return '<div class="search-result" data-uid="' + u.id + '">' + avatarHtml(u, 'sm') +
                            '<div class="meta"><div class="name">' + esc(u.display_name) + '</div>' +
                            '<div class="sub">' + esc(u.about || '') + '</div></div></div>';
                    }).join('')
                    : '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px">No people found</div>';
                $all('#searchResults .search-result').forEach(function (el) {
                    el.addEventListener('click', function () { startChatWith(Number(el.dataset.uid)); close(); });
                });
            }).catch(function () {});
        });
    }
    function startChatWith(userId) {
        API.post('/api/conversations/start/', { user_id: userId }).then(function (conversation) {
            return loadConversations().then(function () { openChat(conversation.id); });
        }).catch(function (err) { toast(err.message || 'Could not start chat'); });
    }

    /* ---------- new chat ---------- */
    $('#btnNewChat').addEventListener('click', openNewChat);
    $('#emptyNewChat').addEventListener('click', openNewChat);
    $('#emptyNewGroup').addEventListener('click', openCreateGroupModal);

    function openNewChat() {
        API.get('/api/chats/people/').then(function (data) {
            var people = (data && (data.results || data)) || [];
            var root = $('#modalRoot');
            root.innerHTML = '<div class="modal-back" id="newChatBack"><div class="modal">' +
                '<div class="modal-head"><h3>New conversation</h3>' +
                '<button class="icon-btn" id="newChatClose">' + ICONS.x + '</button></div>' +
                '<div class="modal-body">' +
                '<div style="display:flex;gap:8px;margin-bottom:16px">' +
                '<button class="btn btn-primary" style="flex:1" id="btnNewGroup">New group</button>' +
                '<button class="btn btn-outline" style="flex:1" id="btnSearchPeople">Find someone</button></div>' +
                '<div id="peopleList">' + (people.length ? people.map(function (p) {
                    return '<div class="search-result" data-uid="' + p.id + '">' + avatarHtml(p, 'sm') +
                        '<div class="meta"><div class="name">' + esc(p.display_name) + '</div>' +
                        '<div class="sub">' + esc(p.masked_phone || '') + '</div></div></div>';
                }).join('') : '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px">No chats yet — use Find someone to search by phone number.</div>') +
                '</div></div></div></div>';
            var close = function () { root.innerHTML = ''; };
            $('#newChatClose').addEventListener('click', close);
            $('#newChatBack').addEventListener('click', function (e) { if (e.target.id === 'newChatBack') close(); });
            $('#btnNewGroup').addEventListener('click', function () { close(); openCreateGroupModal(); });
            $('#btnSearchPeople').addEventListener('click', function () { close(); openGlobalSearch(); });
            $all('#peopleList .search-result').forEach(function (el) {
                el.addEventListener('click', function () { startChatWith(Number(el.dataset.uid)); close(); });
            });
        }).catch(function () { toast('Could not load people'); });
    }

    /* ---------- group create ---------- */
    function openCreateGroupModal() {
        API.get('/api/chats/people/').then(function (data) {
            var people = ((data && (data.results || data)) || []);
            var root = $('#modalRoot');
            var selected = {};
            root.innerHTML = '<div class="modal-back" id="groupBack"><div class="modal" style="width:min(520px,100%)">' +
                '<div class="modal-head"><h3>New group</h3><button class="icon-btn" id="groupClose">' + ICONS.x + '</button></div>' +
                '<div class="modal-body">' +
                '<div class="form-row"><label class="form-label">Group name</label>' +
                '<input class="form-input" id="groupName" placeholder="e.g. Design Team" maxlength="100" /></div>' +
                '<div class="form-row"><label class="form-label">Description (optional)</label>' +
                '<input class="form-input" id="groupDesc" maxlength="200" /></div>' +
                '<div class="form-row"><label class="form-label">Members</label>' +
                '<div id="groupMemberList" style="max-height:260px;overflow-y:auto">' +
                (people.length ? people.map(function (p) {
                    return '<div class="pick-row" data-user="' + p.id + '">' + avatarHtml(p, 'sm') +
                        '<div class="meta"><div class="name">' + esc(p.display_name) + '</div>' +
                        '<div class="sub">' + esc(p.masked_phone || '') + '</div></div>' +
                        '<div class="pick-check">' + ICONS.check + '</div></div>';
                }).join('') : '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px">Chat with someone first, or use Find someone.</div>') +
                '</div></div></div>' +
                '<div class="modal-foot"><button class="btn btn-ghost" id="groupCancel">Cancel</button>' +
                '<button class="btn btn-primary" id="groupCreate" disabled>Create group</button></div></div></div>';
            var close = function () { root.innerHTML = ''; };
            $('#groupClose').addEventListener('click', close);
            $('#groupCancel').addEventListener('click', close);
            $('#groupBack').addEventListener('click', function (e) { if (e.target.id === 'groupBack') close(); });
            var update = function () {
                $('#groupCreate').disabled = !$('#groupName').value.trim() || !Object.keys(selected).length;
            };
            $all('#groupMemberList .pick-row').forEach(function (row) {
                row.addEventListener('click', function () {
                    var id = row.dataset.user;
                    if (selected[id]) { delete selected[id]; row.classList.remove('selected'); }
                    else { selected[id] = true; row.classList.add('selected'); }
                    update();
                });
            });
            $('#groupName').addEventListener('input', update);
            $('#groupCreate').addEventListener('click', function () {
                var name = $('#groupName').value.trim();
                if (!name) return;
                API.post('/api/groups/', {
                    name: name,
                    description: $('#groupDesc').value.trim(),
                    user_ids: Object.keys(selected).map(Number),
                }).then(function (group) {
                    close();
                    return loadConversations().then(function () { openChat(group.id); });
                }).catch(function (err) { toast(err.message || 'Could not create group'); });
            });
            setTimeout(function () { $('#groupName').focus(); }, 100);
        }).catch(function () { toast('Could not load people'); });
    }

    /* ---------- contacts & groups views ---------- */
    function openContactsView() {
        Promise.all([
            API.get('/api/contacts/'),
            API.get('/api/chats/people/'),
        ]).then(function (results) {
            var contacts = ((results[0] && results[0].results) || []);
            var people = ((results[1] && (results[1].results || results[1])) || []);
            var knownIds = {};
            contacts.forEach(function (c) { knownIds[c.contact_id] = true; });
            var suggestions = people.filter(function (p) { return !knownIds[p.id]; });
            var rowHtml = function (p, isContact) {
                return '<div class="member-row" data-uid="' + (p.contact_id || p.id) + '">' +
                    avatarHtml(p, '', { presence: true }) +
                    '<div class="meta"><div class="name">' + esc(p.display_name) + '</div>' +
                    '<div class="sub">' + esc(p.masked_phone || p.about || '') + '</div></div>' +
                    '<div class="member-actions">' +
                    '<button class="icon-btn" data-chat="' + (p.contact_id || p.id) + '" title="Message">' + ICONS.reply + '</button>' +
                    (isContact
                        ? '<button class="icon-btn" data-remove="' + (p.contact_id || p.id) + '" title="Remove">' + ICONS.trash + '</button>'
                        : '<button class="icon-btn" data-add="' + (p.contact_id || p.id) + '" title="Add contact">' + ICONS.userPlus + '</button>') +
                    '</div></div>';
            };
            var root = $('#modalRoot');
            root.innerHTML = '<div class="modal-back" id="contactsBack" style="align-items:flex-start;padding-top:6vh">' +
                '<div class="modal" style="width:min(560px,100%);max-height:86vh">' +
                '<div class="modal-head"><h3>Contacts</h3><button class="icon-btn" id="contactsClose">' + ICONS.x + '</button></div>' +
                '<div class="modal-body">' +
                '<div class="result-group-title">Your contacts · ' + contacts.length + '</div>' +
                (contacts.length ? contacts.map(function (c) { return rowHtml(c, true); }).join('')
                    : '<div style="padding:14px;text-align:center;color:var(--text-3);font-size:13px">No contacts yet — add people you chat with.</div>') +
                (suggestions.length ? '<div class="result-group-title" style="margin-top:16px">People you\'ve chatted with</div>' +
                    suggestions.map(function (p) { return rowHtml(p, false); }).join('') : '') +
                '</div></div></div>';
            var close = function () { root.innerHTML = ''; };
            $('#contactsClose').addEventListener('click', close);
            $('#contactsBack').addEventListener('click', function (e) { if (e.target.id === 'contactsBack') close(); });
            $all('[data-chat]').forEach(function (b) {
                b.addEventListener('click', function () { startChatWith(Number(b.dataset.chat)); close(); });
            });
            $all('[data-add]').forEach(function (b) {
                b.addEventListener('click', function () {
                    API.post('/api/contacts/', { user_id: Number(b.dataset.add) }).then(function () {
                        toast('Contact added'); close(); openContactsView();
                    }).catch(function () {});
                });
            });
            $all('[data-remove]').forEach(function (b) {
                b.addEventListener('click', function () {
                    API.delete('/api/contacts/' + Number(b.dataset.remove) + '/').then(function () {
                        toast('Contact removed'); close(); openContactsView();
                    }).catch(function () {});
                });
            });
        }).catch(function () { toast('Could not load contacts'); });
    }

    function openGroupsView() {
        var groups = State.chats.filter(function (c) { return c.kind === 'group'; });
        var root = $('#modalRoot');
        root.innerHTML = '<div class="modal-back" id="groupsBack" style="align-items:flex-start;padding-top:6vh">' +
            '<div class="modal" style="width:min(560px,100%);max-height:86vh">' +
            '<div class="modal-head"><h3>Groups</h3>' +
            '<button class="btn btn-primary btn-sm" id="groupsNew">New group</button>' +
            '<button class="icon-btn" id="groupsClose">' + ICONS.x + '</button></div>' +
            '<div class="modal-body">' +
            (groups.length ? groups.map(function (g) {
                return '<div class="member-row" data-chat="' + g.id + '">' +
                    groupAvatarHtml({ participants: g.participants }, '') +
                    '<div class="meta"><div class="name">' + esc(g.name) + '</div>' +
                    '<div class="sub">' + g.participants.length + ' members</div></div></div>';
            }).join('') : '<div style="padding:24px;text-align:center;color:var(--text-3);font-size:13px">No groups yet.</div>') +
            '</div></div></div>';
        var close = function () { root.innerHTML = ''; };
        $('#groupsClose').addEventListener('click', close);
        $('#groupsBack').addEventListener('click', function (e) { if (e.target.id === 'groupsBack') close(); });
        $('#groupsNew').addEventListener('click', function () { close(); openCreateGroupModal(); });
        $all('[data-chat]').forEach(function (el) {
            el.addEventListener('click', function () { close(); openChat(el.dataset.chat); });
        });
    }

    /* ---------- profile (self) ---------- */
    function openProfileModal() {
        var me = State.me;
        var root = $('#modalRoot');
        root.innerHTML = '<div class="modal-back" id="profileBack"><div class="modal" style="width:min(460px,100%)">' +
            '<div class="modal-head"><h3>Your profile</h3><button class="icon-btn" id="profileClose">' + ICONS.x + '</button></div>' +
            '<div class="modal-body">' +
            '<div class="profile-hero">' +
            '<div class="avatar xxl" id="profAvatar" style="' + avatarStyle(me) + '">' + (me.avatar_url ? '' : esc(initials(me.display_name))) + '</div>' +
            '<div class="change-photo" id="changePhotoBtn">Change profile photo</div></div>' +
            '<div class="form-row"><label class="form-label">Display name</label>' +
            '<input class="form-input" id="profName" value="' + esc(me.display_name || '') + '" /></div>' +
            '<div class="form-row"><label class="form-label">Phone number</label>' +
            '<input class="form-input" id="profPhone" value="' + esc(me.phone_number || '') + '" disabled /></div>' +
            '<div class="form-row"><label class="form-label">Bio</label>' +
            '<textarea class="form-textarea" id="profBio" rows="2">' + esc(me.about || '') + '</textarea></div>' +
            '</div>' +
            '<div class="modal-foot"><button class="btn btn-ghost" id="profCancel">Cancel</button>' +
            '<button class="btn btn-primary" id="profSave">Save changes</button></div></div></div>';
        var close = function () { root.innerHTML = ''; };
        $('#profileClose').addEventListener('click', close);
        $('#profCancel').addEventListener('click', close);
        $('#profileBack').addEventListener('click', function (e) { if (e.target.id === 'profileBack') close(); });
        $('#changePhotoBtn').addEventListener('click', function () {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.addEventListener('change', function () {
                var file = input.files[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB'); return; }
                var form = new FormData();
                form.append('avatar', file);
                API.post('/api/auth/avatar/', form).then(function (data) {
                    State.me.avatar_url = data.avatar_url;
                    cacheUser(Object.assign({}, me, { avatar_url: data.avatar_url }));
                    $('#profAvatar').style.backgroundImage = 'url(\'' + data.avatar_url + '\')';
                    $('#profAvatar').textContent = '';
                    refreshSelfChrome();
                    toast('Profile photo updated');
                }).catch(function (err) { toast(err.message || 'Upload failed'); });
            });
            input.click();
        });
        $('#profSave').addEventListener('click', function () {
            var name = $('#profName').value.trim();
            var bio = $('#profBio').value.trim();
            API.patch('/api/auth/me/full/', { display_name: name, about: bio }).then(function (data) {
                State.me.display_name = data.display_name;
                State.me.about = data.about;
                refreshSelfChrome();
                toast('Profile saved');
                close();
            }).catch(function (err) { toast(err.message || 'Could not save'); });
        });
    }
    function refreshSelfChrome() {
        var av = $('#selfAvatar');
        var railAv = $('#railAvatar');
        var style = avatarStyle(State.me);
        [av, railAv].forEach(function (el) {
            if (!el) return;
            el.style.cssText = style;
            el.textContent = State.me.avatar_url ? '' : initials(State.me.display_name);
        });
        $('#selfName').textContent = State.me.display_name;
        renderConvList();
    }

    /* ---------- settings ---------- */
    function openSettings(section) {
        section = section || 'account';
        var root = $('#modalRoot');
        var sections = [
            { id: 'account', label: 'Account' },
            { id: 'appearance', label: 'Appearance' },
            { id: 'notifications', label: 'Notifications' },
            { id: 'privacy', label: 'Privacy' },
            { id: 'chats', label: 'Chats' },
        ];
        root.innerHTML = '<div class="settings-screen" id="settingsScreen">' +
            '<nav class="settings-nav" id="settingsNav"><button class="back" id="settingsBack">← Back to app</button>' +
            '<h2>Settings</h2>' +
            sections.map(function (s) {
                return '<button class="settings-nav-item ' + (s.id === section ? 'active' : '') + '" data-section="' + s.id + '"><span>' + s.label + '</span></button>';
            }).join('') + '</nav>' +
            '<div class="settings-content" id="settingsContent"></div></div>';
        var close = function () { root.innerHTML = ''; };
        $('#settingsBack').addEventListener('click', close);
        $all('.settings-nav-item').forEach(function (item) {
            item.addEventListener('click', function () {
                $all('.settings-nav-item').forEach(function (x) { x.classList.toggle('active', x === item); });
                renderSettingsSection(item.dataset.section);
            });
        });
        renderSettingsSection(section);
    }

    function renderSettingsSection(id) {
        var container = $('#settingsContent');
        var prefs = State.prefs;
        var toggleRow = function (title, desc, key, value) {
            return '<div class="settings-row"><div class="settings-row-info"><div class="lbl">' + title + '</div>' +
                (desc ? '<div class="desc">' + desc + '</div>' : '') + '</div>' +
                '<div class="switch ' + (value ? 'on' : '') + '" data-toggle="' + key + '"></div></div>';
        };
        if (id === 'account') {
            container.innerHTML = '<h1>Account</h1><p>Your NEXLINK identity.</p>' +
                '<div class="settings-section"><h2>Profile</h2><div class="settings-row">' +
                avatarHtml(State.me, 'lg') +
                '<div class="settings-row-info"><div class="lbl">' + esc(State.me.display_name) + '</div>' +
                '<div class="desc">' + esc(State.me.phone_number || '') + '</div></div>' +
                '<button class="btn btn-outline" id="openProfileEdit">Edit</button></div></div>';
            $('#openProfileEdit').addEventListener('click', openProfileModal);
        } else if (id === 'appearance') {
            container.innerHTML = '<h1>Appearance</h1><p>Customize how NEXLINK looks on this device.</p>' +
                '<div class="settings-section"><h2>Theme</h2><div class="settings-row">' +
                '<div class="settings-row-info"><div class="lbl">Theme</div><div class="desc">Light, dark, or follow your system</div></div>' +
                '<select class="settings-select" id="themeSelect">' +
                ['light', 'dark', 'system'].map(function (t) {
                    return '<option value="' + t + '"' + (prefs.theme === t ? ' selected' : '') + '>' + t + '</option>';
                }).join('') + '</select></div></div>' +
                '<div class="settings-section"><h2>Accent colour</h2><div class="settings-row">' +
                '<div class="settings-row-info"><div class="lbl">Accent</div><div class="desc">Used for buttons and highlights</div></div>' +
                '<div class="accent-picker">' +
                ['#a78bfa', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#f472b6'].map(function (h) {
                    return '<div class="accent-dot ' + (prefs.accent === h ? 'active' : '') + '" data-accent="' + h + '" style="background:' + h + '"></div>';
                }).join('') + '</div></div></div>';
            $('#themeSelect').addEventListener('change', function () {
                applyTheme(this.value);
                savePrefs({ theme: this.value });
            });
            $all('[data-accent]').forEach(function (dot) {
                dot.addEventListener('click', function () {
                    $all('[data-accent]').forEach(function (x) { x.classList.toggle('active', x === dot); });
                    applyAccent(dot.dataset.accent);
                    savePrefs({ accent: dot.dataset.accent });
                });
            });
        } else if (id === 'notifications') {
            container.innerHTML = '<h1>Notifications</h1><p>Control what you hear about and when.</p>' +
                '<div class="settings-section">' +
                toggleRow('Message notifications', 'Show notifications for new messages', 'notifications', prefs.notifications !== false) +
                toggleRow('Sounds', 'Play a sound for incoming messages', 'sounds', prefs.sounds !== false) +
                '</div>';
        } else if (id === 'privacy') {
            container.innerHTML = '<h1>Privacy</h1><p>Decide who can see your activity.</p>' +
                '<div class="settings-section">' +
                toggleRow('Read receipts', 'Let others know when you\'ve read their messages', 'read_receipts', prefs.read_receipts !== false) +
                toggleRow('Typing indicator', 'Show when you\'re typing', 'typing_indicator', prefs.typing_indicator !== false) +
                toggleRow('Last seen', 'Show when you were last online', 'last_seen_visible', prefs.last_seen_visible !== false) +
                '</div>';
        } else if (id === 'chats') {
            container.innerHTML = '<h1>Chats</h1><p>Set your default chat behaviour.</p>' +
                '<div class="settings-section">' +
                toggleRow('Enter to send', 'Press Enter to send a message', 'enter_to_send', prefs.enter_to_send !== false) +
                '</div>';
        }
        $all('.switch').forEach(function (sw) {
            sw.addEventListener('click', function () {
                sw.classList.toggle('on');
                var key = sw.dataset.toggle;
                prefs[key] = sw.classList.contains('on');
                storeSet('nexus.settings', prefs);
                savePrefs(sw.dataset.toggleOriginal || prefs);
            });
        });
    }
    function savePrefs(patch) {
        API.patch('/api/auth/preferences/', patch).catch(function () {
            toast('Settings could not be synced');
        });
    }

    /* ---------- self status / presence ---------- */
    function setPresenceStatus(status) {
        savePrefs({ status: status });
        if (status === 'invisible') {
            $('#selfStatus').textContent = 'Invisible';
        } else {
            $('#selfStatus').textContent = status.charAt(0).toUpperCase() + status.slice(1);
        }
    }

    /* ---------- rail / bottom nav ---------- */
    function handleRail(name) {
        if (name === 'chats') {
            document.getElementById('app').classList.remove('chat-open');
            closeMenus();
            return;
        }
        if (name === 'contacts') { openContactsView(); return; }
        if (name === 'groups') { openGroupsView(); return; }
        if (name === 'settings') { openSettings('account'); return; }
        if (name === 'notifications') { openNotifications(); return; }
        if (name === 'profile') { openProfileModal(); return; }
    }
    $all('.rail-btn[data-rail]').forEach(function (b) {
        b.addEventListener('click', function () { handleRail(b.dataset.rail); });
    });
    $all('.bottom-nav .nav-btn').forEach(function (b) {
        b.addEventListener('click', function () { handleRail(b.dataset.rail); });
    });
    $('#selfUser').addEventListener('click', openProfileModal);
    $('#btnThemeQuick').addEventListener('click', function () {
        var next = (State.prefs.theme === 'dark') ? 'light' : 'dark';
        applyTheme(next);
        savePrefs({ theme: next });
    });

    $('#convSearch').addEventListener('input', renderConvList);
    $('#filterTabs').addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-filter]');
        if (!btn) return;
        State.filter = btn.dataset.filter;
        $all('#filterTabs button').forEach(function (b) { b.classList.toggle('active', b === btn); });
        renderConvList();
    });
    $('#convList').addEventListener('click', function (e) {
        var el = e.target.closest('.conv');
        if (el) openChat(el.dataset.id);
    });
    $('#convList').addEventListener('contextmenu', function (e) {
        var el = e.target.closest('.conv');
        if (!el) return;
        e.preventDefault();
        var chat = findChat(el.dataset.id);
        if (!chat) return;
        showMenu([
            { label: chat.pinned ? 'Unpin' : 'Pin conversation', onClick: function () {
                API.patch('/api/conversations/' + chat.id + '/state/', { pinned: !chat.pinned }).then(function () {
                    chat.pinned = !chat.pinned; renderConvList();
                }).catch(function () {});
            } },
            { label: chat.muted ? 'Unmute' : 'Mute notifications', onClick: function () {
                API.patch('/api/conversations/' + chat.id + '/state/', { muted: !chat.muted }).then(function () {
                    chat.muted = !chat.muted; renderConvList();
                }).catch(function () {});
            } },
            { label: chat.archived ? 'Unarchive' : 'Archive', onClick: function () {
                API.patch('/api/conversations/' + chat.id + '/state/', { archived: !chat.archived }).then(function () {
                    chat.archived = !chat.archived; renderConvList();
                }).catch(function () {});
            } },
            { sep: true },
            { label: 'Delete conversation', danger: true, onClick: function () {
                if (!confirm('Hide this conversation from your list?')) return;
                API.patch('/api/conversations/' + chat.id + '/state/', { hidden: true }).then(function () {
                    State.chats = State.chats.filter(function (c) { return c.id !== chat.id; });
                    if (State.activeChatId === chat.id) showEmptyChat();
                    renderConvList();
                    toast('Conversation removed');
                }).catch(function () {});
            } },
        ], e.clientX, e.clientY);
    });

    /* ============================================================
       BOOT
       ============================================================ */
    function boot() {
        if (!State.me || !State.me.id) {
            // Not authenticated: the server redirects, but fail soft here.
            window.location.href = '/accounts/login/';
            return;
        }
        cacheUser(State.me);

        var savedTheme = storeGet('nexus.theme', State.prefs.theme || 'dark');
        var savedAccent = storeGet('nexus.accent', State.prefs.accent || '#a78bfa');
        applyTheme(savedTheme);
        applyAccent(savedAccent);

        refreshSelfChrome();
        connectSockets();
        loadConversations().then(function () {
            var initial = BOOT.initialConversationId;
            if (initial && findChat(initial)) {
                openChat(initial);
            } else {
                showEmptyChat();
            }
        });
    }

    boot();
})();
