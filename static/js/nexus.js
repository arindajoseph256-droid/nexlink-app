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
        outbox: storeGet('nexus.outbox', []), // messages composed while offline
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
    /* Default accent follows the active theme: mint on deep teal in dark,
       brand teal in light — the palette used by the login/register pages. */
    var DEFAULT_ACCENT = { light: '#00a884', dark: '#74ffd6' };
    /* Pre-rebrand saved accents (Midnight Violet era) map onto the teal family. */
    var LEGACY_ACCENT = {
        '#a78bfa': '#74ffd6', '#8b5cf6': '#00a884', '#ec4899': '#06cf9c',
        '#f472b6': '#2dd4bf', '#06b6d4': '#06b6a4', '#10b981': '#10b981',
        '#f59e0b': '#f59e0b', '#ef4444': '#ef4444'
    };
    function currentTheme() {
        var t = document.documentElement.getAttribute('data-theme');
        return t === 'light' ? 'light' : 'dark';
    }
    function applyTheme(theme) {
        var resolved = theme;
        if (theme === 'system') {
            resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
        }
        document.documentElement.setAttribute('data-theme', resolved || 'dark');
        var meta = $('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', resolved === 'light' ? '#eef4f1' : '#071d22');
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
        hex = LEGACY_ACCENT[hex.toLowerCase()] || hex;
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-h', shade(hex, -20));
        document.documentElement.style.setProperty('--accent-2', shade(hex, 25));
        var rgb = hexToRgb(hex);
        document.documentElement.style.setProperty('--accent-sub', 'rgba(' + rgb + ',.16)');
        document.documentElement.style.setProperty('--accent-soft', 'rgba(' + rgb + ',.08)');
        document.documentElement.style.setProperty('--accent-glow', 'rgba(' + rgb + ',.42)');
        State.prefs.accent = hex;
        storeSet('nexus.accent', hex);
        var active = document.querySelector('.accent-dot');
        if (active) {
            $all('.accent-dot').forEach(function (x) { x.classList.toggle('active', x.dataset.accent === hex); });
        }
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
    var _menuOpenedAt = 0;
    function showMenu(items, x, y) {
        closeMenus();
        _menuOpenedAt = Date.now();
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
        if (!openMenu) return;
        if (openMenu.contains(e.target)) return;
        if (Date.now() - _menuOpenedAt < 350) return; /* ignore the click that opened the menu */
        closeMenus();
    });

    /* ---------- avatars ---------- */
    function avatarStyle(user) {
        return 'background:' + hueColor(user && user.id);
    }
    function avatarImg(user) {
        var url = user && user.avatar_url;
        return url ? '<img src="' + esc(url) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    }
    /* Initials avatars always sit on a brand-teal wash so white text and
       presence dots stay readable; the id only varies the tone. */
    var AVATAR_HUES = ['#008069', '#0d9488', '#0f766e', '#047857', '#15803d', '#00a884'];
    function hueColor(id) {
        return AVATAR_HUES[Math.abs(Number(id) || 0) % AVATAR_HUES.length];
    }
    function avatarHtml(user, size, opts) {
        opts = opts || {};
        var cls = 'avatar ' + (size || '');
        var presence = (opts.presence && user && user.is_online)
            ? '<span class="presence"' + (opts.presenceBorder ? ' style="border-color:' + opts.presenceBorder + '"' : '') + '></span>'
            : '';
        var inner = esc(initials(user && user.display_name));
        return '<div class="' + cls + '" data-uid="' + (user ? user.id : '') + '" style="' + avatarStyle(user) + '">' + inner + avatarImg(user) + presence + '</div>';
    }
    function senderAvatarHtml(user) {
        if (!user) return '';
        return '<div class="msg-sender" data-uid="' + user.id + '" style="' + avatarStyle(user) + '">' +
            esc(initials(user.display_name)) + avatarImg(user) + '</div>';
    }
    function groupAvatarHtml(group, size) {
        var members = (group && group.participants || []).slice(0, 4);
        var cells = [0, 1, 2, 3].map(function (i) {
            var member = members[i];
            if (!member) return '<i style="background:var(--bg-hover)"></i>';
            var user = State.users[member.id] || member;
            return '<i style="background:' + hueColor(user.id) + '">' + esc(initials(user.display_name)) + avatarImg(user) + '</i>';
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
            oldestLoadedId: null,
            loadingOlder: false,
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
            /* API pages are chronological (oldest→newest). Merge keeping
               ascending order so the newest messages sit at the BOTTOM of
               the chat (WhatsApp style); older pages load on scroll-up. */
            var incoming = results.map(normalizeMessage);
            chat.messages = mergeChronological(chat.messages, incoming);
            if (!data.has_more) chat.fullyLoaded = true;
            chat.oldestLoadedId = data.oldest_id || (incoming.length ? incoming[0].id : null);
            State.messagesLoaded[chatId] = true;
            renderMessages();
        }).catch(function () {
            toast('Could not load messages');
        });
    }

    function loadOlderMessages(chatId) {
        var chat = findChat(chatId);
        if (!chat || chat.fullyLoaded || chat.loadingOlder) return Promise.resolve();
        if (!chat.oldestLoadedId) return Promise.resolve();
        chat.loadingOlder = true;
        return API.get('/api/conversations/' + chatId + '/messages/?before=' + chat.oldestLoadedId)
            .then(function (data) {
                var results = (data && data.results) || [];
                if (!results.length) { chat.fullyLoaded = true; return; }
                var incoming = results.map(normalizeMessage);
                chat.messages = mergeChronological(incoming, chat.messages);
                if (!data.has_more) chat.fullyLoaded = true;
                chat.oldestLoadedId = data.oldest_id || chat.oldestLoadedId;
                renderMessages();
            })
            .catch(function () { /* transient: retried on next scroll-up */ })
            .then(function () { chat.loadingOlder = false; });
    }

    /* Merge two ascending message lists without duplicates; result ascending. */
    function mergeChronological(older, newer) {
        var seen = {};
        var out = [];
        older.concat(newer).forEach(function (m) {
            if (seen[m.id]) return;
            seen[m.id] = true;
            out.push(m);
        });
        out.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
        return out;
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

        /* ---------- call events (Phase 6.1) ---------- */
        Socket.on('call.incoming', function (event) {
            if (event.caller_id === State.me.id) return;
            handleIncoming(event);
        });
        Socket.on('call.accepted', function (event) {
            if (String(event.call_id) !== String(CALL_STATE.callId)) return;
            if (CALL_STATE.isCaller) setCallStatus('Connecting…');
        });
        Socket.on('call.ended', function (event) {
            if (String(event.call_id) !== String(CALL_STATE.callId)) return;
            var wasActive = CALL_STATE.view === 'active';
            teardownCall();
            if (wasActive) toast('Call ended');
        });
        Socket.on('call.signal', function (event) {
            handleSignalEvent(event);
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
        State._stickBottom = true;
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
        State.outbox.filter(function (o) { return String(o.chatId) === String(chat.id); }).forEach(function (o) {
            html += '<div class="msg-row out queued" data-outbox-id="' + esc(o.id) + '">' +
                '<div class="msg-content"><div class="bubble"><span>' + esc(o.text) + '</span>' +
                '<div class="msg-meta"><span>' + fmtTime(o.ts) + '</span>' +
                '<span class="status">' + ICONS.clock + '</span></div></div></div></div>';
        });
        if (State.typing[chat.id]) {
            html += '<div class="typing-row"><div class="typing-bubble"><i></i><i></i><i></i></div></div>';
        }
        box.innerHTML = html;
        /* Keep the user's place: jump to bottom only when already near it
           (or when the chat was just opened); preserve position otherwise. */
        if (State._stickBottom) {
            requestAnimationFrame(function () { box.scrollTop = box.scrollHeight; });
        }
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
        var meta = starIcon + pinIcon + '<span>' + fmtTime(m.ts) + '</span>' +
            (status ? '<span class="status ' + (m.state === 'read' ? 'read' : '') + '">' + status + '</span>' : '');
        return '<div class="msg-row ' + (mine ? 'out' : 'in') + (isFirst ? ' first' : '') + '" data-msg-id="' + m.id + '">' +
            senderAvatar +
            '<div class="msg-content"><div class="bubble">' + inner +
            '<div class="msg-meta">' + meta + '</div></div>' +
            reactionsHtml +
            '</div></div>';
    }

    function statusIcon(state) {
        if (state === 'queued') return ICONS.clock;
        if (state === 'failed') return ICONS.xCircle;
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
        clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        xCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
        x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        userPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
        users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
        block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
        phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
        video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
        callIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 2 16 8 22 8"/><path d="M22 2l-6 6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
        callOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 8 2 8 2 2"/><path d="M2 2l6 6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
        link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
        report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
        image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    };

    /* ---------- messages interactions ---------- */
    $('#messages').addEventListener('click', function (e) {
        var image = e.target.closest('.attach-img img');
        if (image && image.src) {
            openLightbox(image.src);
            return;
        }
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
        if (!navigator.onLine && text) {
            queueOutbox(chat.id, text);
            return;
        }
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
        e.stopPropagation(); /* keep the document outside-click handler from closing the menu instantly */
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
        var chat = activeChat();
        if (chat && chat.kind !== 'group') startCall(chat.id, 'voice');
        else if (chat) toast('Calls are 1:1 only');
    });
    $('#btnVideoCall').addEventListener('click', function () {
        var chat = activeChat();
        if (chat && chat.kind !== 'group') startCall(chat.id, 'video');
        else if (chat) toast('Calls are 1:1 only');
    });
    $('#btnCallEnd').addEventListener('click', hangUp);
    $('#btnCallMute').addEventListener('click', toggleMute);
    $('#btnCallCam').addEventListener('click', toggleCam);
    $('#btnIncomingAccept').addEventListener('click', acceptIncomingCall);
    $('#btnIncomingDecline').addEventListener('click', declineIncomingCall);
    $('#lightboxClose').addEventListener('click', closeLightbox);
    $('#lightboxBack').addEventListener('click', function (e) {
        if (e.target.id === 'lightboxBack') closeLightbox();
    });
    $('#btnChatSearch').addEventListener('click', toggleInChatSearch);

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
            '<button class="info-item" data-info-action="media">' + ICONS.image + '<span class="lbl">Media, links and docs</span></button>' +
            '<button class="info-item" data-info-action="search">' + ICONS.search + '<span class="lbl">Search in conversation</span></button>' +
            '<button class="info-item" data-info-action="clear">' + ICONS.trash + '<span class="lbl">Clear chat</span></button>' +
            '<button class="info-item" data-info-action="block">' + ICONS.block + '<span class="lbl">Block contact</span></button>' +
            '<button class="info-item danger" data-info-action="report">' + ICONS.report + '<span class="lbl">Report contact</span></button>' +
            '</div></div>';
        $all('[data-info-action]').forEach(function (b) {
            b.addEventListener('click', function () {
                var a = b.dataset.infoAction;
                if (a === 'media') {
                    openMediaGallery(chat.id);
                } else if (a === 'block') {
                    API.post('/api/users/' + peer.id + '/block/').then(function () { toast('Contact blocked'); }).catch(function () {});
                } else if (a === 'report') {
                    showReportMenu(peer.id);
                } else if (a === 'clear') {
                    API.post('/api/conversations/' + chat.id + '/clear/').then(function () {
                        chat.messages = []; renderMessages(); toast('Chat cleared');
                    }).catch(function () {});
                } else {
                    toggleInChatSearch();
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

    /* ============================================================
       CALLS (Phase 6.1) — history view + WebRTC 1:1 engine
       ============================================================ */
    var CALL_STATE = {
        view: null,          // 'ringing' | 'active' | 'incoming'
        callId: null,
        conversationId: null,
        kind: 'voice',
        peer: null,
        isCaller: false,
        pc: null,
        localStream: null,
        remoteStream: null,
        timerInterval: null,
        startedAt: null,
        pendingIce: [],
        hasRemoteDesc: false,
        incomingTimer: null,
    };

    var RTCCONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

    function callPeerName() {
        return (CALL_STATE.peer && CALL_STATE.peer.display_name) || 'Unknown';
    }

    function fmtDuration(totalSeconds) {
        var s = Math.max(0, Math.floor(totalSeconds || 0));
        var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        function two(v) { return (v < 10 ? '0' : '') + v; }
        return (h ? two(h) + ':' : '') + two(m) + ':' + two(sec);
    }

    function setCallStatus(text) {
        var el = $('#callStatus');
        if (el) el.textContent = text;
    }

    function fillCallPeerAvatar() {
        $('#callPeerAvatar').innerHTML = avatarHtml(CALL_STATE.peer, '');
    }

    function openCallScreen(mode) {
        fillCallPeerAvatar();
        $('#callPeerName').textContent = callPeerName();
        $('#callTimer').classList.add('hidden');
        $('#callRemoteVideo').classList.add('hidden');
        $('#callLocalVideo').classList.add('hidden');
        $('#btnCallMute').classList.add('hidden');
        $('#btnCallCam').classList.add('hidden');
        $('#btnCallMute').classList.remove('active');
        setCallStatus(mode === 'outgoing' ? 'Ringing…' : 'Incoming ' + (CALL_STATE.kind === 'video' ? 'video' : 'voice') + ' call…');
        $('#callScreen').classList.remove('hidden');
        setCallActionsForPhase(mode);
    }

    function setCallActionsForPhase(mode) {
        var isVideo = CALL_STATE.kind === 'video';
        // Mute is relevant once media flows; camera toggle only for video calls.
        $('#btnCallMute').classList.toggle('hidden', mode === 'incoming');
        $('#btnCallCam').classList.toggle('hidden', mode === 'incoming' || !isVideo);
    }

    function closeCallScreen() {
        $('#callScreen').classList.add('hidden');
        $('#incomingBack').classList.add('hidden');
    }

    function stopMedia() {
        if (CALL_STATE.localStream) {
            CALL_STATE.localStream.getTracks().forEach(function (t) { t.stop(); });
        }
        if (CALL_STATE.pc) {
            CALL_STATE.pc.ontrack = null;
            CALL_STATE.pc.onicecandidate = null;
            try { CALL_STATE.pc.close(); } catch (e) { /* ignore */ }
        }
        if (CALL_STATE.timerInterval) clearInterval(CALL_STATE.timerInterval);
        CALL_STATE.pc = null;
        CALL_STATE.localStream = null;
        CALL_STATE.remoteStream = null;
        CALL_STATE.timerInterval = null;
        CALL_STATE.pendingIce = [];
        CALL_STATE.hasRemoteDesc = false;
    }

    function teardownCall() {
        stopMedia();
        closeCallScreen();
        CALL_STATE.view = null;
        CALL_STATE.callId = null;
        CALL_STATE.conversationId = null;
        CALL_STATE.peer = null;
        clearTimeout(CALL_STATE.incomingTimer);
    }

    function startTimer() {
        var timerEl = $('#callTimer');
        CALL_STATE.startedAt = Date.now();
        timerEl.classList.remove('hidden');
        setCallStatus('Connected');
        CALL_STATE.timerInterval = setInterval(function () {
            timerEl.textContent = fmtDuration((Date.now() - CALL_STATE.startedAt) / 1000);
        }, 500);
    }

    function getUserMediaSafe(video) {
        var constraints = video
            ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } }
            : { audio: true, video: false };
        return navigator.mediaDevices.getUserMedia(constraints).catch(function (err) {
            if (!video) throw err;
            // Camera-free machines can still make the voice portion work.
            return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        });
    }

    function createPeer() {
        var pc = new RTCPeerConnection(RTCCONFIG);
        CALL_STATE.localStream.getTracks().forEach(function (track) {
            pc.addTrack(track, CALL_STATE.localStream);
        });
        CALL_STATE.remoteStream = new MediaStream();
        pc.ontrack = function (event) {
            CALL_STATE.remoteStream.addTrack(event.track);
            var video = $('#callRemoteVideo');
            var audioOnly = CALL_STATE.kind !== 'video';
            if (audioOnly) return; // audio plays through the default output
            video.srcObject = CALL_STATE.remoteStream;
            video.classList.remove('hidden');
            $('#callLocalVideo').classList.remove('hidden');
        }
        ;
        pc.onicecandidate = function (event) {
            if (!event.candidate) return;
            API.post('/api/calls/' + CALL_STATE.callId + '/signal/', {
                signal_type: 'ice', payload: event.candidate.toJSON(),
            }).catch(function () { /* best effort */ });
        };
        pc.onconnectionstatechange = function () {
            if (pc.connectionState === 'connected') startTimer();
            if (pc.connectionState === 'failed') {
                toast('Call connection failed');
                hangUp();
            }
        };
        return pc;
    }

    function sendPendingIce(pc) {
        var queued = CALL_STATE.pendingIce;
        CALL_STATE.pendingIce = [];
        queued.forEach(function (candidate) {
            pc.addIceCandidate(candidate).catch(function () { /* ignore */ });
        });
    }

    function attachRemoteVideo(stream) {
        CALL_STATE.remoteStream = stream;
        var video = $('#callRemoteVideo');
        if (CALL_STATE.kind === 'video') {
            video.srcObject = stream;
            video.classList.remove('hidden');
            $('#callLocalVideo').classList.remove('hidden');
        }
    }

    /* Caller: start ringing the peer. */
    function startCall(conversationId, kind) {
        if (CALL_STATE.view) { toast('Already in a call'); return; }
        var chat = findChat(conversationId);
        var peer = chat && chat.peer ? chat.peer : null;
        if (!peer) { toast('Calls are 1:1 only'); return; }
        API.post('/api/conversations/' + conversationId + '/calls/', { kind: kind }).then(function (call) {
            CALL_STATE.view = 'ringing';
            CALL_STATE.callId = call.id;
            CALL_STATE.conversationId = call.conversation;
            CALL_STATE.kind = call.kind;
            CALL_STATE.peer = call.peer;
            CALL_STATE.isCaller = true;
            cacheUser(call.peer);
            openCallScreen('outgoing');
            // No answer within 45s: end the call (server marks it missed).
            clearTimeout(CALL_STATE.incomingTimer);
            CALL_STATE.incomingTimer = setTimeout(function () {
                if (CALL_STATE.view === 'ringing') { toast('No answer'); hangUp(); }
            }, 45000);
            return getUserMediaSafe(call.kind === 'video').then(function (stream) {
                CALL_STATE.localStream = stream;
                var localVideo = $('#callLocalVideo');
                if (call.kind === 'video') {
                    localVideo.srcObject = stream;
                    localVideo.classList.remove('hidden');
                }
                CALL_STATE.pc = createPeer();
                return CALL_STATE.pc.createOffer().then(function (offer) {
                    return CALL_STATE.pc.setLocalDescription(offer).then(function () {
                        return API.post('/api/calls/' + CALL_STATE.callId + '/signal/', {
                            signal_type: 'offer', payload: { sdp: CALL_STATE.pc.localDescription.sdp, type: CALL_STATE.pc.localDescription.type },
                        });
                    });
                });
            });
        }).catch(function (err) {
            toast(err.message || 'Could not start the call');
            teardownCall();
        });
    }

    /* Callee: accept an incoming ring. */
    function acceptIncomingCall() {
        clearTimeout(CALL_STATE.incomingTimer);
        $('#incomingBack').classList.add('hidden');
        API.post('/api/calls/' + CALL_STATE.callId + '/answer/').then(function () {
            CALL_STATE.view = 'active';
            $('#incomingBack').classList.add('hidden');
            openCallScreen('incoming');
            setCallStatus('Connecting…');
            return getUserMediaSafe(CALL_STATE.kind === 'video').then(function (stream) {
                CALL_STATE.localStream = stream;
                var localVideo = $('#callLocalVideo');
                if (CALL_STATE.kind === 'video') {
                    localVideo.srcObject = stream;
                    localVideo.classList.remove('hidden');
                }
                CALL_STATE.pc = createPeer();
                sendPendingIce(CALL_STATE.pc);
                if (CALL_STATE.pendingOffer) {
                    applyRemoteOffer(CALL_STATE.pendingOffer);
                    CALL_STATE.pendingOffer = null;
                }
            });
        }).catch(function (err) {
            toast(err.message || 'Could not answer');
            teardownCall();
        });
    }
    function declineIncomingCall() {
        clearTimeout(CALL_STATE.incomingTimer);
        API.post('/api/calls/' + CALL_STATE.callId + '/decline/').catch(function () { /* ignore */ });
        teardownCall();
    }

    function hangUp() {
        var callId = CALL_STATE.callId;
        if (callId) {
            API.post('/api/calls/' + callId + '/end/').catch(function () { /* ignore */ });
        }
        teardownCall();
    }

    function handleSignalEvent(event) {
        if (event.from_id === State.me.id) return;
        if (String(event.call_id) !== String(CALL_STATE.callId)) return;
        if (event.signal_type === 'offer') {
            if (CALL_STATE.hasRemoteDesc) return; // glare: keep the first offer
            var desc = new RTCSessionDescription(event.payload);
            if (CALL_STATE.pc) {
                applyRemoteOffer(desc);
            } else {
                CALL_STATE.pendingOffer = desc; // acceptIncomingCall() picks it up
            }
            return;
        }
        if (event.signal_type === 'answer') {
            if (!CALL_STATE.pc || CALL_STATE.hasRemoteDesc) return;
            CALL_STATE.pc.setRemoteDescription(new RTCSessionDescription(event.payload)).then(function () {
                CALL_STATE.hasRemoteDesc = true;
                sendPendingIce(CALL_STATE.pc);
            }).catch(function () { /* ignore */ });
            return;
        }
        if (event.signal_type === 'ice') {
            if (!CALL_STATE.pc || !CALL_STATE.hasRemoteDesc) {
                CALL_STATE.pendingIce.push(event.payload);
                return;
            }
            CALL_STATE.pc.addIceCandidate(new RTCIceCandidate(event.payload)).catch(function () { /* ignore */ });
        }
    }

    function handleIncoming(event) {
        if (CALL_STATE.view) return; // busy: server records a missed call when it times out
        var peer = {
            id: event.caller_id,
            display_name: event.caller || 'Unknown',
            avatar_url: (State.users[event.caller_id] || {}).avatar_url,
        };
        CALL_STATE.view = 'incoming';
        CALL_STATE.callId = event.call_id;
        CALL_STATE.conversationId = event.conversation_id;
        CALL_STATE.kind = event.kind || 'voice';
        CALL_STATE.peer = peer;
        CALL_STATE.isCaller = false;
        CALL_STATE.pendingOffer = null;
        $('#incomingAvatar').innerHTML = avatarHtml(peer, '');
        $('#incomingName').textContent = peer.display_name;
        $('#incomingKind').textContent = (CALL_STATE.kind === 'video' ? 'Video call' : 'Voice call');
        $('#incomingBack').classList.remove('hidden');
        // Stop ringing after 45s; the caller's hang-up records the missed call.
        clearTimeout(CALL_STATE.incomingTimer);
        CALL_STATE.incomingTimer = setTimeout(teardownCall, 45000);
    }

    function toggleMute() {
        if (!CALL_STATE.localStream) return;
        var track = CALL_STATE.localStream.getAudioTracks()[0];
        if (!track) return;
        track.enabled = !track.enabled;
        $('#btnCallMute').classList.toggle('active', !track.enabled);
        toast(track.enabled ? 'Microphone on' : 'Microphone muted');
    }

    function toggleCam() {
        if (!CALL_STATE.localStream) return;
        var track = CALL_STATE.localStream.getVideoTracks()[0];
        if (!track) return;
        track.enabled = !track.enabled;
        $('#btnCallCam').classList.toggle('active', !track.enabled);
        toast(track.enabled ? 'Camera on' : 'Camera off');
    }

    /* ---------- calls rail view ---------- */
    var CALLS_TAB = 'recent';
    function openCallsView() {
        API.get('/api/calls/').then(function (data) {
            var calls = (data && (data.results || data)) || [];
            calls.forEach(function (c) { cacheUser(c.peer); });
            renderCallsModal(calls);
        }).catch(function () { toast('Could not load call history'); });
    }
    function renderCallsModal(calls) {
        var root = $('#modalRoot');
        var filtered = function (tab) {
            return calls.filter(function (c) {
                if (tab === 'missed') return c.status === 'missed';
                if (tab === 'voice') return c.kind === 'voice';
                if (tab === 'video') return c.kind === 'video';
                return true;
            });
        };
        var draw = function () {
            var list = filtered(CALLS_TAB);
            root.innerHTML = '<div class="modal-back" id="callsBack" style="align-items:flex-start;padding-top:6vh">' +
                '<div class="modal" style="width:min(560px,100%);max-height:86vh">' +
                '<div class="modal-head"><h3>Calls</h3><button class="icon-btn" id="callsClose">' + ICONS.x + '</button></div>' +
                '<div class="calls-tabs">' +
                [['recent', 'Recent'], ['missed', 'Missed'], ['voice', 'Voice'], ['video', 'Video']].map(function (pair) {
                    return '<button class="' + (CALLS_TAB === pair[0] ? 'active' : '') + '" data-ctab="' + pair[0] + '">' + pair[1] + '</button>';
                }).join('') + '</div>' +
                '<div class="modal-body" id="callsList" style="padding:8px">' +
                (list.length ? list.map(function (c) {
                    var missed = c.status === 'missed' || c.status === 'declined';
                    var outgoing = c.direction === 'outgoing';
                    var arrow = outgoing ? ICONS.callOut : ICONS.callIn;
                    var sub = missed
                        ? '<span class="sub missed">' + arrow + ' ' + esc(c.status) + '</span>'
                        : '<span class="sub">' + arrow + ' ' + esc(c.direction) +
                          (c.duration_seconds != null ? ' · ' + fmtDuration(c.duration_seconds) : '') + '</span>';
                    return '<div class="call-row" data-conv="' + c.conversation + '">' +
                        avatarHtml(c.peer, '') +
                        '<div class="meta"><div class="name">' + esc(c.peer.display_name) + '</div>' + sub + '</div>' +
                        '<div class="call-acts">' +
                        '<button class="icon-btn" data-callvoice="' + c.conversation + '" title="Voice call">' + ICONS.phone + '</button>' +
                        '<button class="icon-btn" data-callvideo="' + c.conversation + '" title="Video call">' + ICONS.video + '</button>' +
                        '</div></div>';
                }).join('') : '<div style="padding:24px;text-align:center;color:var(--text-3);font-size:13px">No calls yet. Start one from any chat.</div>') +
                '</div></div></div>';
            var close = function () { root.innerHTML = ''; };
            $('#callsClose').addEventListener('click', close);
            $('#callsBack').addEventListener('click', function (e) { if (e.target.id === 'callsBack') close(); });
            $all('#callsList [data-ctab], .calls-tabs [data-ctab]').forEach(function (b) {
                b.addEventListener('click', function () { CALLS_TAB = b.dataset.ctab; draw(); });
            });
            $all('#callsList [data-callvoice]').forEach(function (b) {
                b.addEventListener('click', function () { close(); startCall(Number(b.dataset.callvoice), 'voice'); });
            });
            $all('#callsList [data-callvideo]').forEach(function (b) {
                b.addEventListener('click', function () { close(); startCall(Number(b.dataset.callvideo), 'video'); });
            });
            $all('#callsList .call-row').forEach(function (row) {
                row.addEventListener('click', function (e) {
                    if (e.target.closest('button')) return;
                    close();
                    openChat(row.dataset.conv);
                });
            });
        };
        draw();
    }


    /* ============================================================
       MEDIA GALLERY (Phase 6.2) + lightbox
       ============================================================ */
    function openLightbox(url) {
        $('#lightboxImg').src = url;
        $('#lightboxBack').classList.remove('hidden');
    }
    function closeLightbox() {
        $('#lightboxImg').src = '';
        $('#lightboxBack').classList.add('hidden');
    }

    var MG_TAB = 'media';
    function openMediaGallery(conversationId) {
        API.get('/api/conversations/' + conversationId + '/media/').then(function (data) {
            var media = (data && data.media) || [];
            var links = (data && data.links) || [];
            media.forEach(function (m) { cacheUser(m.sender); });
            renderMediaGalleryModal(media, links);
        }).catch(function () { toast('Could not load media'); });
    }

    function renderMediaGalleryModal(media, links) {
        var root = $('#modalRoot');
        var emptyGallery = function (text) {
            return '<div style="padding:24px;text-align:center;color:var(--text-3);font-size:13px">' + esc(text) + '</div>';
        };
        var draw = function () {
            var images = media.filter(function (m) { return m.message_type === 'image'; });
            var docs = media.filter(function (m) { return m.message_type !== 'image'; });
            var body = '';
            if (MG_TAB === 'media') {
                body = images.length
                    ? '<div class="media-grid">' + images.map(function (m) {
                        return '<div class="media-thumb" data-url="' + esc(m.attachment_url) + '">' +
                            '<img src="' + esc(m.attachment_url) + '" alt="" loading="lazy"></div>';
                    }).join('') + '</div>'
                    : emptyGallery('No images yet');
            } else if (MG_TAB === 'links') {
                body = links.length
                    ? links.map(function (l) {
                        return '<a class="link-row" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' +
                            ICONS.link + '<div class="meta"><div class="url">' + esc(l.url) + '</div>' +
                            '<div class="sub">' + esc(l.sender || '') + ' · ' + fmtShort(l.created_at) + '</div></div></a>';
                    }).join('')
                    : emptyGallery('No links shared yet');
            } else {
                body = docs.length
                    ? docs.map(function (m) {
                        return '<a class="link-row" href="' + esc(m.attachment_url) + '" target="_blank" rel="noopener noreferrer">' +
                            ICONS.file + '<div class="meta"><div class="url">' + esc(m.attachment_name || 'Attachment') + '</div>' +
                            '<div class="sub">' + esc((m.sender && m.sender.display_name) || '') + ' · ' +
                            esc(fmtBytes(m.attachment_size)) + ' · ' + fmtShort(m.created_at) + '</div></div></a>';
                    }).join('')
                    : emptyGallery('No documents yet');
            }
            root.innerHTML = '<div class="modal-back" id="mediaBack" style="align-items:flex-start;padding-top:6vh">' +
                '<div class="modal" style="width:min(600px,100%);max-height:86vh">' +
                '<div class="modal-head"><h3>Media, links and docs</h3>' +
                '<button class="icon-btn" id="mediaClose">' + ICONS.x + '</button></div>' +
                '<div class="calls-tabs">' +
                [['media', 'Media'], ['links', 'Links'], ['docs', 'Docs']].map(function (pair) {
                    return '<button class="' + (MG_TAB === pair[0] ? 'active' : '') + '" data-mgtab="' + pair[0] + '">' + pair[1] + '</button>';
                }).join('') + '</div>' +
                '<div class="modal-body" style="padding:12px">' + body + '</div></div></div>';
            var close = function () { root.innerHTML = ''; };
            $('#mediaClose').addEventListener('click', close);
            $('#mediaBack').addEventListener('click', function (e) { if (e.target.id === 'mediaBack') close(); });
            $all('[data-mgtab]').forEach(function (b) {
                b.addEventListener('click', function () { MG_TAB = b.dataset.mgtab; draw(); });
            });
            $all('.media-thumb').forEach(function (thumb) {
                thumb.addEventListener('click', function () { openLightbox(thumb.dataset.url); });
            });
        };
        draw();
    }

    /* ============================================================
       IN-CHAT SEARCH
       ============================================================ */
    var inchatHits = [];
    var inchatCursor = 0;

    function toggleInChatSearch() {
        if ($('#inchatSearch')) { removeInChatSearch(); return; }
        var chat = activeChat();
        if (!chat) return;
        var bar = document.createElement('div');
        bar.className = 'inchat-search';
        bar.id = 'inchatSearch';
        bar.innerHTML = ICONS.search +
            '<input id="inchatSearchInput" type="text" placeholder="Search in this chat…" spellcheck="false" />' +
            '<span class="count" id="inchatCount"></span>' +
            '<button class="icon-btn" id="inchatClose">' + ICONS.x + '</button>';
        $('#chatPanel').insertBefore(bar, $('#messages'));
        $('#inchatClose').addEventListener('click', removeInChatSearch);
        var input = $('#inchatSearchInput');
        input.focus();
        input.addEventListener('input', function () { runInChatSearch(); });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') removeInChatSearch();
            if (e.key === 'Enter') { e.preventDefault(); cycleInChatHit(e.shiftKey ? -1 : 1); }
        });
        runInChatSearch();
    }

    function removeInChatSearch() {
        var bar = $('#inchatSearch');
        if (bar) bar.remove();
        $all('#messages .msg-row.hit, #messages .msg-row.hit-current').forEach(function (row) {
            row.classList.remove('hit', 'hit-current');
        });
        inchatHits = [];
        inchatCursor = 0;
    }

    function runInChatSearch() {
        var chat = activeChat();
        if (!chat) return;
        var query = (($('#inchatSearchInput') || {}).value || '').trim().toLowerCase();
        $all('#messages .msg-row.hit, #messages .msg-row.hit-current').forEach(function (row) {
            row.classList.remove('hit', 'hit-current');
        });
        inchatHits = [];
        inchatCursor = 0;
        if (!query) { $('#inchatCount').textContent = ''; return; }
        chat.messages.forEach(function (m) {
            if (m.deleted) return;
            var haystack = (m.text || '') + ' ' + ((m.attachment && m.attachment.name) || '');
            if (haystack.toLowerCase().includes(query)) inchatHits.push(String(m.id));
        });
        inchatHits.forEach(function (id) {
            var row = $('#messages .msg-row[data-msg-id="' + id + '"]');
            if (row) row.classList.add('hit');
        });
        $('#inchatCount').textContent = inchatHits.length ? ('1/' + inchatHits.length) : '0 results';
        if (inchatHits.length) focusInChatHit(0);
    }

    function cycleInChatHit(delta) {
        if (!inchatHits.length) return;
        inchatCursor = (inchatCursor + delta + inchatHits.length) % inchatHits.length;
        focusInChatHit(inchatCursor);
        $('#inchatCount').textContent = (inchatCursor + 1) + '/' + inchatHits.length;
    }

    function focusInChatHit(index) {
        $all('#messages .msg-row.hit-current').forEach(function (row) { row.classList.remove('hit-current'); });
        var row = $('#messages .msg-row[data-msg-id="' + inchatHits[index] + '"]');
        if (row) {
            row.classList.add('hit-current');
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    /* ---------- report menu (Phase 6.2) ---------- */
    var REPORT_REASONS = [
        ['spam', 'Spam'],
        ['harassment', 'Harassment'],
        ['impersonation', 'Impersonation'],
        ['inappropriate', 'Inappropriate content'],
        ['other', 'Something else'],
    ];

    function showReportMenu(userId) {
        showMenu(REPORT_REASONS.map(function (pair) {
            return { label: pair[1], icon: ICONS.report, onClick: function () {
                API.post('/api/users/' + userId + '/report/', { reason: pair[0] }).then(function () {
                    toast('Report sent — contact blocked');
                }).catch(function (err) { toast(err.message || 'Could not report'); });
            } };
        }), 120, 120);
    }

    /* ---------- global search ---------- */
    $('#btnGlobalSearch').addEventListener('click', openGlobalSearch);
    document.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openGlobalSearch();
        }
        if (e.key === 'Escape') closeMenus();
    });
    var SEARCH_DEBOUNCE_MS = 250;
    var SEARCH_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    function openGlobalSearch() {
        var root = $('#modalRoot');
        root.innerHTML = '<div class="modal-back" id="searchBack" style="align-items:flex-start;padding-top:12vh">' +
            '<div class="modal" style="width:min(560px,100%)"><div class="modal-head">' +
            '<span class="search-ico">' + ICONS.search + '</span>' +
            '<input id="globalSearchInput" placeholder="Search name or phone number…" style="flex:1;background:transparent;border:none;outline:none;font-size:15px;color:var(--text-1);font-family:inherit" />' +
            '<button class="icon-btn" id="searchClose">' + ICONS.x + '</button></div>' +
            '<div class="modal-body" id="searchResults" style="padding:8px"></div></div></div>';
        var close = function () { root.innerHTML = ''; };
        $('#searchClose').addEventListener('click', close);
        $('#searchBack').addEventListener('click', function (e) { if (e.target.id === 'searchBack') close(); });
        var input = $('#globalSearchInput');
        var timer = null;
        input.focus();
        input.addEventListener('input', function () {
            if (timer) clearTimeout(timer);
            timer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
        });
        function runSearch() {
            var q = input.value.trim();
            var box = $('#searchResults');
            if (!box) return;
            if (q.length < 2) {
                box.innerHTML = '<div class="search-empty"><div class="hint">Search people by name or phone number…</div></div>';
                return;
            }
            API.get('/api/users/search/?q=' + encodeURIComponent(q)).then(function (data) {
                var results = (data && data.results) || [];
                if (results.length) {
                    box.innerHTML = results.map(function (u) {
                        var sub = u.masked_phone || u.about || '';
                        return '<div class="search-result" data-uid="' + u.id + '">' + avatarHtml(u, 'sm') +
                            '<div class="meta"><div class="name">' + esc(u.display_name) + '</div>' +
                            '<div class="sub">' + esc(sub) + '</div></div>' +
                            '<span class="chev">' + SEARCH_CHEV + '</span></div>';
                    }).join('');
                } else {
                    box.innerHTML = phoneFallbackHtml(q);
                }
                bindSearchResults(close);
            }).catch(function () {
                var box2 = $('#searchResults');
                if (box2) box2.innerHTML = phoneFallbackHtml(q);
                bindSearchResults(close);
            });
        }
    }
    function phoneFallbackHtml(q) {
        return '<div class="search-empty"><div class="hint">No one found for “' + esc(q) + '”.</div>' +
            '<button class="btn btn-outline" id="btnChatByPhone">Chat with a phone number</button></div>';
    }
    function bindSearchResults(close) {
        $all('#searchResults .search-result').forEach(function (el) {
            el.addEventListener('click', function () { startChatWith(Number(el.dataset.uid)); close(); });
        });
        var phoneBtn = $('#btnChatByPhone');
        if (phoneBtn) phoneBtn.addEventListener('click', function () { close(); openPhoneChat(); });
    }
    function openPhoneChat() {
        var root = $('#modalRoot');
        root.innerHTML = '<div class="modal-back" id="phoneBack"><div class="modal" style="width:min(420px,100%)">' +
            '<div class="modal-head"><h3>New chat by phone</h3><button class="icon-btn" id="phoneClose">' + ICONS.x + '</button></div>' +
            '<div class="modal-body">' +
            '<div class="form-row"><label class="form-label">Phone number</label>' +
            '<input class="form-input" id="phoneChatInput" type="tel" inputmode="tel" autocomplete="off" placeholder="+256 7XX XXX XXX" />' +
            '<div id="phoneChatError" style="display:none;color:var(--danger);font-size:12.5px;margin-top:6px"></div></div>' +
            '<p style="color:var(--text-3);font-size:12.5px;margin:0 0 14px">They need a NEXLINK account. Local numbers also work — we add the country code for you.</p>' +
            '<button class="btn btn-primary" style="width:100%" id="phoneChatGo">Start chat</button>' +
            '</div></div></div>';
        var close = function () { root.innerHTML = ''; };
        $('#phoneClose').addEventListener('click', close);
        $('#phoneBack').addEventListener('click', function (e) { if (e.target.id === 'phoneBack') close(); });
        var input = $('#phoneChatInput');
        var errBox = $('#phoneChatError');
        var btn = $('#phoneChatGo');
        input.focus();
        function showError(msg) { errBox.textContent = msg; errBox.style.display = 'block'; }
        function submit() {
            var phone = input.value.trim();
            if (!phone) { showError('Enter a phone number.'); return; }
            btn.disabled = true;
            API.post('/api/chats/by-phone/', { phone: phone }).then(function (conversation) {
                close();
                return loadConversations().then(function () { openChat(conversation.id); });
            }).catch(function (err) {
                btn.disabled = false;
                showError(err.message || 'Could not start that chat.');
            });
        }
        btn.addEventListener('click', submit);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
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
                '<div style="display:flex;gap:8px;margin-bottom:8px">' +
                '<button class="btn btn-primary" style="flex:1" id="btnNewGroup">New group</button>' +
                '<button class="btn btn-outline" style="flex:1" id="btnSearchPeople">Find someone</button></div>' +
                '<button class="btn btn-primary" style="width:100%;margin-bottom:8px" id="btnFindPeople">Find people to chat with</button>' +
                '<button class="btn btn-outline" style="width:100%;margin-bottom:16px" id="btnPhoneChat">Chat with a phone number</button>' +
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
            $('#btnPhoneChat').addEventListener('click', function () { close(); openPhoneChat(); });
            $('#btnFindPeople').addEventListener('click', function () { close(); openFindPeopleView(); });
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

    /* ---------- find people (contact discovery: WhatsApp/Instagram-style) ---------- */
    function discoverySourceLabel(p) {
        var sources = p.sources || [];
        if (sources.indexOf('phone') >= 0) return 'From your contacts';
        if (sources.indexOf('email') >= 0) return 'From your contacts (email)';
        if (p.is_contact || p.source === 'phone_contacts' || p.source === 'google_contacts') return 'From your contacts';
        if (p.mutual_contacts > 0) return p.mutual_contacts + ' mutual contact' + (p.mutual_contacts === 1 ? '' : 's');
        if (p.shared_groups > 0) return p.shared_groups === 1 ? 'Shared group' : 'Member of ' + p.shared_groups + ' groups with you';
        if (p.source === 'nexlink') return 'You may know each other';
        return 'On NEXLINK';
    }
    function discoveryRowHtml(p) {
        return '<div class="member-row" data-uid="' + p.id + '">' + avatarHtml(p, '', { presence: true }) +
            '<div class="meta"><div class="name">' + esc(p.display_name) + '</div>' +
            '<div class="sub">' + esc(discoverySourceLabel(p)) + '</div></div>' +
            '<div class="member-actions"><button class="btn btn-primary btn-sm" data-discover-chat="' + p.id + '">Chat</button></div></div>';
    }
    function openFindPeopleView() {
        var root = $('#modalRoot');
        root.innerHTML = '<div class="modal-back" id="findPeopleBack" style="align-items:flex-start;padding-top:6vh">' +
            '<div class="modal" style="width:min(560px,100%);max-height:86vh">' +
            '<div class="modal-head"><h3>Find People</h3><button class="icon-btn" id="findPeopleClose">' + ICONS.x + '</button></div>' +
            '<div class="modal-body" style="padding-top:8px">' +
            '<div id="findPeopleState" style="text-align:center;color:var(--text-3);font-size:13px;padding:12px">Loading suggestions…</div>' +
            '<div id="findPeopleContactsSection" style="display:none">' +
            '<div class="result-group-title" style="margin-top:10px">Contacts on NEXLINK</div>' +
            '<div id="findPeopleContactsList"></div>' +
            '<div style="display:flex;gap:8px;margin:10px 0 4px">' +
            '<button class="btn btn-outline" style="flex:1" id="btnFindPhoneContacts">📱 Find from my saved contacts</button>' +
            '</div>' +
            '<div id="phoneMatchHint" style="display:none;color:var(--text-3);font-size:12.5px;margin:4px 0 10px">The Android app matches your phone’s address book; on web, save people as contacts below and we’ll match their numbers.</div>' +
            '</div>' +
            '<div id="findPeopleSuggestionsSection" style="display:none">' +
            '<div class="result-group-title" style="margin-top:14px">People You May Know</div>' +
            '<div id="findPeopleSuggestionsList"></div>' +
            '</div>' +
            '<div id="findPeopleSync" style="display:none;color:var(--text-3);font-size:12px;margin-top:6px"></div>' +
            '</div></div></div>';
        var close = function () { root.innerHTML = ''; };
        $('#findPeopleClose').addEventListener('click', close);
        $('#findPeopleBack').addEventListener('click', function (e) { if (e.target.id === 'findPeopleBack') close(); });
        bindDiscoveryChats(close);

        function bindDiscoveryChats(onClose) {
            $all('[data-discover-chat]').forEach(function (b) {
                b.addEventListener('click', function () { startChatWith(Number(b.dataset.discoverChat)); onClose(); });
            });
        }

        Promise.all([
            API.get('/api/chats/people/'),
            API.get('/api/contacts/suggestions/'),
        ]).then(function (results) {
            var people = ((results[0] && results[0].results) || []);
            var suggestions = ((results[1] && results[1].results) || []);
            var state = $('#findPeopleState');
            if (state) state.remove();
            var contactsSection = $('#findPeopleContactsSection');
            var suggestionsSection = $('#findPeopleSuggestionsSection');
            if (!contactsSection || !suggestionsSection) return;
            if (people.length) {
                contactsSection.style.display = 'block';
                $('#findPeopleContactsList').innerHTML = people.slice(0, 12).map(discoveryRowHtml).join('');
            }
            if (suggestions.length) {
                suggestionsSection.style.display = 'block';
                $('#findPeopleSuggestionsList').innerHTML = suggestions.map(discoveryRowHtml).join('');
            }
            bindDiscoveryChats(function () { close(); });
            $('#btnFindPhoneContacts').addEventListener('click', function () {
                $('#phoneMatchHint').style.display = 'block';
            });
        }).catch(function () {
            var state = $('#findPeopleState');
            if (state) state.textContent = 'Could not load suggestions. Check your connection and try again.';
        });
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
                var content = $('#settingsContent');
                if (content) content.scrollTop = 0;
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
                ['#74ffd6', '#00a884', '#06cf9c', '#2dd4bf', '#0ea5e9', '#f59e0b', '#ec4899', '#ef4444'].map(function (h) {
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
            var push = window.NexlinkPush;
            var pushState = push ? push.status() : 'unsupported';
            var pushOn = pushState === 'granted';
            var pushDesc = {
                granted: 'Enabled on this device — you get notifications even with Nexlink closed.',
                denied: 'Blocked in your browser settings — allow notifications for this site first.',
                default: 'Off — click the switch to enable real device notifications.',
                unsupported: 'This browser does not support push notifications.',
                insecure: 'Push needs a secure (https) connection.',
            }[pushState] || '';
            container.innerHTML = '<h1>Notifications</h1><p>Control what you hear about and when.</p>' +
                '<div class="settings-section"><h2>Push notifications</h2>' +
                '<div class="settings-row"><div class="settings-row-info"><div class="lbl">Device notifications</div>' +
                '<div class="desc" id="pushDesc">' + pushDesc + '</div></div>' +
                '<div class="switch ' + (pushOn ? 'on' : '') + '" id="pushSwitch"></div></div></div>' +
                '<div class="settings-section"><h2>In app</h2>' +
                toggleRow('Message notifications', 'Show notifications for new messages', 'notifications', prefs.notifications !== false) +
                toggleRow('Sounds', 'Play a sound for incoming messages', 'sounds', prefs.sounds !== false) +
                '</div>';
            var pushSwitch = $('#pushSwitch');
            if (pushSwitch && push) {
                pushSwitch.addEventListener('click', function () {
                    var state = push.status();
                    if (state === 'granted') {
                        push.disable().then(function () { renderSettingsSection(id); });
                    } else if (state === 'default') {
                        push.enable().then(function (ok) {
                            if (ok) { renderSettingsSection(id); toast('Device notifications enabled'); }
                            else { renderSettingsSection(id); }
                        });
                    }
                    // 'denied' | 'unsupported' | 'insecure': no-op — the description explains why.
                });
            }
        } else if (id === 'privacy') {
            container.innerHTML = '<h1>Privacy</h1><p>Decide who can see your activity.</p>' +
                '<div class="settings-section">' +
                toggleRow('Read receipts', 'Let others know when you\'ve read their messages', 'read_receipts', prefs.read_receipts !== false) +
                toggleRow('Typing indicator', 'Show when you\'re typing', 'typing_indicator', prefs.typing_indicator !== false) +
                toggleRow('Last seen', 'Show when you were last online', 'last_seen_visible', prefs.last_seen_visible !== false) +
                '</div>' +
                '<div class="settings-section"><h2>Contact discovery</h2><p style="color:var(--text-3);font-size:12.5px;margin:-2px 0 8px">Control how other people can find you on NEXLINK.</p>' +
                toggleRow('Find me by my phone number', 'People who have your number in their contacts can see you', 'discoverable_by_phone', prefs.discoverable_by_phone !== false) +
                toggleRow('Find me by my email', 'People who have your email can see you', 'discoverable_by_email', prefs.discoverable_by_email !== false) +
                toggleRow('Show me in People You May Know', 'Suggest you to people you share contacts or groups with', 'discoverable_in_suggestions', prefs.discoverable_in_suggestions !== false) +
                '</div>';
        } else if (id === 'chats') {
            container.innerHTML = '<h1>Chats</h1><p>Set your default chat behaviour.</p>' +
                '<div class="settings-section">' +
                toggleRow('Enter to send', 'Press Enter to send a message', 'enter_to_send', prefs.enter_to_send !== false) +
                '</div>';
        }
        $all('.switch').forEach(function (sw) {
            if (sw.id === 'pushSwitch') return; // has its own handler above
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
        if (name === 'calls') { openCallsView(); return; }
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

    /* Load older messages when scrolled near the top (WhatsApp style). */
    $('#messages').addEventListener('scroll', function () {
        var box = this;
        var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        State._stickBottom = nearBottom;
        if (box.scrollTop <= 60) {
            var chat = activeChat();
            if (chat && !chat.fullyLoaded && !chat.loadingOlder) {
                var anchor = box.scrollHeight - box.scrollTop;
                loadOlderMessages(chat.id).then(function () {
                    /* restore the viewport so rows appended above don't shift it */
                    box.scrollTop = box.scrollHeight - anchor;
                });
            }
        }
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
    /* ---------- connection state + offline outbox ---------- */
    var ConnState = { socketUp: false, bannerShown: 'none' };

    function showBanner(kind, text) {
        var banner = $('#connBanner');
        if (!banner) return;
        if (kind === 'none') { banner.hidden = true; banner.className = 'conn-banner'; ConnState.bannerShown = 'none'; return; }
        banner.hidden = false;
        banner.className = 'conn-banner ' + kind;
        banner.innerHTML = '<span class="dot"></span>' + esc(text);
        ConnState.bannerShown = kind;
    }

    function effectiveConn() {
        if (!navigator.onLine) return 'offline';
        if (!ConnState.socketUp) return 'connecting';
        return 'none';
    }

    function refreshConnBanner() {
        showBanner(effectiveConn(), {
            offline: 'You are offline — messages will send when you reconnect',
            connecting: 'Reconnecting…',
        }[effectiveConn()] || '');
    }

    function queueOutbox(chatId, text) {
        State.outbox.push({
            id: 'o' + Date.now() + Math.random().toString(36).slice(2, 7),
            chatId: chatId, text: text, ts: new Date().toISOString(),
        });
        storeSet('nexus.outbox', State.outbox);
        var chat = findChat(chatId);
        if (chat) {
            chat.lastMessage = { id: null, sender_id: State.me.id, body: text, created_at: new Date().toISOString(), state: 'queued' };
        }
        renderMessages();
        renderConvList();
        toast('You are offline — message queued');
    }

    function flushOutbox() {
        if (!State.outbox.length || !navigator.onLine) return;
        var pending = State.outbox.splice(0, State.outbox.length);
        storeSet('nexus.outbox', State.outbox);
        pending.forEach(function (item) {
            var payload = { body: item.text };
            API.post('/api/conversations/' + item.chatId + '/messages/', payload).then(function (created) {
                var chat = findChat(item.chatId);
                if (chat && created && created.id) {
                    chat.messages.push(normalizeMessage(created));
                    chat.lastMessage = { id: created.id, sender_id: State.me.id, body: created.body, created_at: created.created_at, state: created.state };
                    renderMessages();
                    renderConvList();
                }
            }).catch(function () {
                // requeue in front so ordering is preserved
                State.outbox.unshift(item);
                storeSet('nexus.outbox', State.outbox);
            });
        });
    }

    window.addEventListener('online', function () {
        refreshConnBanner();
        flushOutbox();
        Socket.connectUser();
        var chat = activeChat();
        if (chat) Socket.connect(chat.id);
    });
    window.addEventListener('offline', function () {
        refreshConnBanner();
    });
    Socket.on('socket.connected', function () {
        ConnState.socketUp = true;
        refreshConnBanner();
        flushOutbox();
    });
    Socket.on('socket.disconnected', function () {
        ConnState.socketUp = false;
        refreshConnBanner();
    });

    /* ---------- PWA ---------- */
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/service-worker.js').catch(function () { /* PWA is progressive enhancement */ });
        });
    }

    function boot() {
        if (!State.me || !State.me.id) {
            // Not authenticated: the server redirects, but fail soft here.
            window.location.href = '/accounts/login/';
            return;
        }
        cacheUser(State.me);

        var savedTheme = storeGet('nexus.theme', State.prefs.theme || 'dark');
        var savedAccent = storeGet('nexus.accent', State.prefs.accent || DEFAULT_ACCENT[currentTheme()]);
        applyTheme(savedTheme);
        applyAccent(savedAccent);

        refreshSelfChrome();
        refreshConnBanner();
        connectSockets();
        // Silent Web Push sync — only acts when permission is already
        // granted; never prompts on page load.
        if (window.NexlinkPush) {
            window.NexlinkPush.sync();
        }
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
