<script>
    import { onMount } from 'svelte';
    import { marked } from 'marked';
    import { chat } from '#lib/chat.js';
    import { messages, chats } from '../lib/messages';
    import { goto } from '$app/navigation';
    import { page } from '$app/state';

    let query = $state('');
    let isProcessing = $state(false);
    let id = null;
    let abortController = null;
    let textLogs;

    let speaking = false;
    let currentUtterance = null;
    let mobileMenuOpen = $state(false);

    function closeMobileMenu() {
        mobileMenuOpen = false;
    }

    function scrollToBottom() {
        if (textLogs) {
            textLogs.scrollTo({
                top: textLogs.scrollHeight,
                behavior: 'smooth'
            });
        }
    }

    function removeUrlParameter(paramKey) {
        const url = new URL(window.location.href);
        url.searchParams.delete(paramKey);
        window.history.replaceState(window.history.state, '', url.href);
    }

    function saveChat() {
        if (!id) return;

        chats.update((current) =>
            current.map((c) =>
                c.id === id ? { ...c, messages: $messages } : c
            )
        );

        scrollToBottom();
    }

    async function generateTitle(chatId, content) {
        try {
            const response = await fetch('http://localhost:11434/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'qwen3:8b',
                    messages: [
                        {
                            role: 'system',
                            content:
                                "Generate a concise, descriptive title of exactly 4 words that captures the main topic of the user's first message. Use clear, natural wording. Do not include quotation marks, explanations, punctuation, or any text other than the title.\n\nUser's first message: " +
                                content
                        }
                    ],
                    stream: false,
                    think: false
                })
            });

            if (!response.ok) throw new Error('Title generation failed');

            const data = await response.json();
            const title = data.message.content.trim();

            chats.update((current) =>
                current.map((c) =>
                    c.id === chatId ? { ...c, title } : c
                )
            );
        } catch (error) {
            console.error('Title generation error:', error);
        }
    }

    function addMessage(role, content) {
        if (!id) {
            id = crypto.randomUUID();

            chats.update((current) => [
                ...current,
                {
                    title: 'New Chat',
                    messages: [],
                    id
                }
            ]);
        }

        messages.update((current) => [
            ...current,
            {
                role,
                content
            }
        ]);

        saveChat();
        scrollToBottom();
    }

    async function submit(event) {
        event?.preventDefault();

        if (isProcessing || !query.trim()) return;

        isProcessing = true;
        abortController = new AbortController();

        const userMessage = query.trim();
        query = '';

        addMessage('user', userMessage);
        addMessage('assistant', '');

        try {
            await chat(
                userMessage,
                (token) => {
                    messages.update((current) => {
                        const updated = [...current];
                        const last = updated.length - 1;

                        updated[last] = {
                            ...updated[last],
                            content: updated[last].content + token
                        };

                        return updated;
                    });

                    saveChat();
                },
                abortController.signal
            );

            const currentChat = $chats.find((c) => c.id === id);

            if (currentChat?.title === 'New Chat') {
                generateTitle(id, userMessage);
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error(error);

                messages.update((current) => {
                    const updated = [...current];
                    const last = updated.length - 1;

                    if (last >= 0 && updated[last].role === 'assistant') {
                        updated[last] = {
                            ...updated[last],
                            content: 'Something went wrong. Please try again.'
                        };
                    }

                    return updated;
                });
            }

            saveChat();
        } finally {
            isProcessing = false;
            abortController = null;
            scrollToBottom();
        }
    }

    function stopGeneration() {
        abortController?.abort();
    }

    function newChat() {
        if (isProcessing) return;
        closeMobileMenu();

        id = null;
        messages.set([]);
        query = '';
        stopSpeaking();
    }

    function changeChat(chatId) {
        if (isProcessing) return;
        closeMobileMenu();

        const selectedChat = $chats.find((c) => c.id === chatId);

        if (!selectedChat) return;

        id = chatId;
        messages.set(selectedChat.messages);
        query = '';
        stopSpeaking();

        scrollToBottom();
    }

    function speak(text) {
        window.speechSynthesis.cancel();

        if (speaking) {
            speaking = false;
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);

        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onstart = () => {
            speaking = true;
        };

        utterance.onend = () => {
            speaking = false;
            currentUtterance = null;
        };

        utterance.onerror = () => {
            speaking = false;
            currentUtterance = null;
        };

        currentUtterance = utterance;
        window.speechSynthesis.speak(utterance);
    }

    function stopSpeaking() {
        window.speechSynthesis.cancel();
        speaking = false;
        currentUtterance = null;
    }

    onMount(() => {
        const params = new URLSearchParams(window.location.search);
        const initialQuery = params.get('query');

        if (initialQuery?.trim()) {
            query = initialQuery.trim();

            requestAnimationFrame(async () => {
                submit();
                removeUrlParameter('query');
            });
        }
    });
</script>

<main class="app">
    {#if mobileMenuOpen}
        <button
            class="sidebar-backdrop"
            type="button"
            aria-label="Close conversation history"
            onclick={closeMobileMenu}
        ></button>
    {/if}

    <!-- Sidebar -->
    <aside
        id="history"
        class:mobile-open={mobileMenuOpen}
        aria-label="Conversation history"
    >
        <div class="sidebar-top">
            <div class="brand">
                <div class="brand-icon">
                    <i class="fa-solid fa-sparkles"></i>
                </div>

                <div>
                    <strong>Arthur</strong>
                    <small>AI Assistant</small>
                </div>
            </div>

            <button
                class="outline secondary new-chat"
                onclick={newChat}
                disabled={isProcessing}
            >
                <i class="fa-solid fa-plus"></i>
                New chat
            </button>

            <button
                class="outline secondary new-chat"
                onclick={() => goto('./profile')}
                disabled={isProcessing}
            >
                Generate a Profile
            </button>

            <button
                class="outline secondary new-chat"
                onclick={() => goto('./map')}
                disabled={isProcessing}
            >
                See Boundaries of Districts
            </button>

            <button
                class="mobile-sidebar-close"
                type="button"
                aria-label="Close conversation history"
                onclick={closeMobileMenu}
            >
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>

        <div class="history-heading">
            <small>YOUR CONVERSATIONS</small>
        </div>

        <div class="history-list">
            {#each $chats as c (c.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <article
                    class="historyCard"
                    class:active={id === c.id}
                    onclick={() => changeChat(c.id)}
                >
                    <i class="fa-regular fa-message"></i>

                    <p
                        contenteditable="true"
                        onblur={(e) => {
                            const title = e.currentTarget.textContent.trim();

                            chats.update((allChats) =>
                                allChats.map((chat) =>
                                    chat.id === c.id ? { ...chat, title } : chat
                                )
                            );
                        }}
                        onkeydown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                e.currentTarget.blur();
                            }
                        }}
                        onclick={(e) => e.stopPropagation()}
                    >
                        {c.title}
                    </p>
                </article>
            {/each}

            {#if $chats.length === 0}
                <p class="empty-history">
                    Your conversations will appear here.
                </p>
            {/if}
        </div>

        <div class="sidebar-bottom">
            <div class="model-indicator">
                <span class="status-dot"></span>
                <div>
                    <strong>Qwen 3:8B</strong>
                    <small>Running locally</small>
                </div>
            </div>
        </div>
    </aside>

    <!-- Main chat -->
    <section id="chat">
        <header class="chat-header">
            <button
                class="menu-toggle"
                type="button"
                aria-label="Open conversation history"
                onclick={() => (mobileMenuOpen = true)}
            >
                <i class="fa-solid fa-bars"></i>
            </button>

            <div class="chat-header-title">
                <strong>Arthur</strong>
                <small>How can I help you?</small>
            </div>

            <div class="header-status">
                <span class="status-dot"></span>
                <small>Online</small>
            </div>
        </header>

        <div class="textLogs" bind:this={textLogs}>
            {#if $messages.length === 0}
                <div class="filler">
                    <h1>Hi, I'm Arthur.</h1>
                    <p>What would you like to explore today?</p>
                </div>
            {:else}
                {#each $messages as m, i (i)}
                    {#if m.role === 'user'}
                        <article class="text user">
                            {@html marked.parse(m.content)}
                        </article>
                    {:else}
                        {#if m.content === '' && i === $messages.length - 1}
                            <article class="loading">
                                <div aria-busy="true"></div>
                            </article>
                        {:else}
                            <article class="text ai">
                                <div class="message-content">
                                    {@html marked.parse(m.content)}
                                </div>

                                <button
                                    class="listen secondary outline"
                                    aria-label="Read response aloud"
                                    title="Read response aloud"
                                    onclick={() => {
                                        if (!speaking) speak(m.content);
                                        else stopSpeaking();
                                    }}
                                >
                                    <i class="fa-solid fa-volume-high"></i>
                                </button>
                            </article>
                        {/if}
                    {/if}
                {/each}
            {/if}
        </div>

        <div class="input-area">
            <form onsubmit={submit} class="input" autocomplete="off">
                <input
                    type="text"
                    bind:value={query}
                    name="input"
                    placeholder="Message Arthur..."
                    disabled={isProcessing}
                />

                <button
                    type={isProcessing ? 'button' : 'submit'}
                    class="send-button"
                    onclick={isProcessing ? stopGeneration : undefined}
                    disabled={!isProcessing && !query.trim()}
                    aria-label={isProcessing ? 'Stop generation' : 'Send message'}
                >
                    {#if isProcessing}
                        <i class="fa-solid fa-stop"></i>
                    {:else}
                        <i class="fa-solid fa-arrow-up"></i>
                    {/if}
                </button>
            </form>

            <small class="input-disclaimer">
                Arthur can make mistakes. Verify important information.
            </small>
        </div>
    </section>
</main>

<style>
    .app {
        display: flex;
        width: 100%;
        height: 100dvh;
        min-height: 500px;
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: var(--pico-background-color);
    }

    #history {
        display: flex;
        flex-direction: column;
        width: 260px;
        min-width: 260px;
        height: 100%;
        margin: 0;
        padding: 1rem;
        border-right: 1px solid var(--pico-muted-border-color);
        border-radius: 0;
        background: var(--pico-card-background-color);
        overflow: hidden;
    }

    .sidebar-top {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    .brand {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem;
    }

    .brand-icon,
    .welcome-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.75rem;
        background: transparent;
        color: var(--pico-primary-inverse);
    }

    .brand strong,
    .brand small,
    .model-indicator strong,
    .model-indicator small {
        display: block;
    }

    .brand strong {
        font-size: 1rem;
    }

    .brand small,
    .model-indicator small {
        color: var(--pico-muted-color);
        font-size: 0.75rem;
    }

    .new-chat {
        width: 100%;
        margin: 0;
        font-size: 0.85rem;
    }

    .history-heading {
        margin: 2rem 0 0.75rem;
        padding: 0 0.5rem;
    }

    .history-heading small {
        color: var(--pico-muted-color);
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.08em;
    }

    .history-list {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
    }

    .historyCard {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        margin: 0 0 0.3rem;
        padding: 0.7rem;
        border: 1px solid transparent;
        border-radius: 0.5rem;
        background: transparent;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .historyCard:hover,
    .historyCard.active {
        background: var(--pico-secondary-background);
    }

    .historyCard.active {
        border-color: var(--pico-muted-border-color);
    }

    .historyCard > i {
        flex-shrink: 0;
        color: var(--pico-muted-color);
        font-size: 0.85rem;
    }

    .historyCard p {
        flex: 1;
        min-width: 0;
        margin: 0;
        overflow: hidden;
        font-size: 0.82rem;
        text-overflow: ellipsis;
        white-space: nowrap;
        outline: none;
    }

    .empty-history {
        padding: 0.5rem;
        color: var(--pico-muted-color);
        font-size: 0.8rem;
    }

    .sidebar-bottom {
        padding-top: 1rem;
        border-top: 1px solid var(--pico-muted-border-color);
    }

    .model-indicator {
        display: flex;
        align-items: center;
        gap: 0.7rem;
        padding: 0.5rem;
    }

    .model-indicator strong {
        font-size: 0.8rem;
    }

    .status-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        flex-shrink: 0;
        border-radius: 50%;
        background: #36a66b;
    }

    #chat {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        height: 100%;
        margin: 0;
        padding: 0;
        border-radius: 0;
        background: var(--pico-background-color);
    }

    .chat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 65px;
        padding: 0.75rem 1.75rem;
        border-bottom: 1px solid var(--pico-muted-border-color);
    }

    .chat-header strong,
    .chat-header small {
        display: block;
    }

    .chat-header strong {
        font-size: 0.95rem;
    }

    .chat-header small {
        color: var(--pico-muted-color);
        font-size: 0.75rem;
    }

    .header-status {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .textLogs {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 1rem;
        width: 100%;
        max-width: 850px;
        margin: 0 auto;
        padding: 2rem 1.5rem;
        overflow-y: auto;
        scroll-behavior: smooth;
    }

    .filler {
        display: flex;
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
    }

    .welcome-icon {
        width: 3.5rem;
        height: 3.5rem;
        margin-bottom: 1.25rem;
        border-radius: 1rem;
        font-size: 1.4rem;
    }

    .filler h1 {
        margin-bottom: 0.5rem;
        font-size: clamp(1.7rem, 4vw, 2.3rem);
    }

    .filler p {
        color: var(--pico-muted-color);
    }

    .text {
        width: fit-content;
        max-width: 85%;
        margin: 0;
        padding: 0.9rem 1.1rem;
        border: 1px solid var(--pico-muted-border-color);
        border-radius: 1rem;
        font-size: 0.95rem;
        line-height: 1.7;
        overflow-wrap: anywhere;
    }

    .text p:last-child {
        margin-bottom: 0;
    }

    .text.user {
        align-self: flex-end;
        border-color: transparent;
        border-bottom-right-radius: 0.25rem;
        background: var(--pico-primary-background);
        color: var(--pico-primary-inverse);
    }

    .text.ai {
        align-self: flex-start;
        display: flex;
        flex-direction: column;
        max-width: 100%;
        width: 100%;
        padding: 1rem 1.25rem 0.5rem;
        border: none;
        border-radius: 0;
        background: transparent;
    }

    .message-content {
        width: 100%;
    }

    .message-content :global(pre) {
        max-width: 100%;
        overflow-x: auto;
    }

    .message-content :global(img) {
        max-width: 100%;
        height: auto;
    }

    .message-content :global(table) {
        display: block;
        max-width: 100%;
        overflow-x: auto;
    }

    .listen {
        align-self: flex-start;
        width: auto;
        margin: 0.5rem 0 0;
        padding: 0.35rem 0.55rem;
        font-size: 0.8rem;
    }

    .loading {
        align-self: flex-start;
        width: 100%;
        margin: 0;
        padding: 0.5rem;
        border: none;
        background: transparent;
    }

    .loading div {
        width: 100%;
        max-width: 100%;
    }

    .input-area {
        width: 100%;
        max-width: 850px;
        margin: 0 auto;
        padding: 0 1.5rem 1rem;
    }

    .input {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin: 0;
        padding: 0.5rem;
        border: 1px solid var(--pico-muted-border-color);
        border-radius: 1rem;
        background: var(--pico-card-background-color);
        box-shadow: var(--pico-card-box-shadow);
    }

    .input input {
        flex: 1;
        min-width: 0;
        margin: 0;
        padding: 0.6rem 0.75rem;
        border: none;
        background: transparent;
        box-shadow: none;
    }

    .input input:focus {
        box-shadow: none;
    }

    .send-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        flex-shrink: 0;
        margin: 0;
        padding: 0;
        border-radius: 0.75rem;
    }

    .input-disclaimer {
        display: block;
        margin-top: 0.6rem;
        color: var(--pico-muted-color);
        font-size: 0.7rem;
        text-align: center;
    }

    .menu-toggle,
    .mobile-sidebar-close,
    .sidebar-backdrop {
        display: none;
    }

    @media (max-width: 700px) {
        .app {
            height: 100dvh;
            min-height: 0;
        }

        #history {
            position: fixed;
            top: 0;
            bottom: 0;
            left: 0;
            z-index: 999;
            width: min(85vw, 320px);
            min-width: 0;
            height: 100dvh;
            padding: 1rem;
            border-right: 1px solid var(--pico-muted-border-color);
            box-shadow: 0 0 30px rgba(0, 0, 0, 0.18);
            transform: translateX(-105%);
            transition: transform 0.25s ease;
        }

        #history.mobile-open {
            transform: translateX(0);
        }

        .brand {
            justify-content: flex-start;
            padding: 0.5rem;
        }

        .brand > div:last-child,
        .history-heading,
        .historyCard p,
        .empty-history,
        .model-indicator > div {
            display: block;
        }

        .new-chat {
            display: flex;
            justify-content: flex-start;
            width: 100%;
            padding: 0.65rem 0.75rem;
        }

        .historyCard {
            justify-content: flex-start;
            padding: 0.75rem;
        }

        .historyCard p {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .model-indicator {
            justify-content: flex-start;
        }

        .mobile-sidebar-close {
            display: flex;
            align-items: center;
            justify-content: center;
            position: absolute;
            top: 1rem;
            right: 1rem;
            width: 2.25rem;
            height: 2.25rem;
            margin: 0;
            padding: 0;
            border-radius: 0.65rem;
        }

        .sidebar-backdrop {
            display: block;
            position: fixed;
            inset: 0;
            z-index: 998;
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: 0;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(2px);
        }

        .chat-header {
            gap: 0.75rem;
            padding: 0.65rem 0.85rem;
        }

        .chat-header-title {
            flex: 1;
            min-width: 0;
        }

        .menu-toggle {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 2.5rem;
            height: 2.5rem;
            flex: 0 0 2.5rem;
            margin: 0;
            padding: 0;
            border: 1px solid var(--pico-muted-border-color);
            border-radius: 0.75rem;
            background: transparent;
            color: var(--pico-color);
        }

        .header-status {
            flex-shrink: 0;
        }

        .textLogs {
            padding: 1rem 0.75rem;
            gap: 0.85rem;
        }

        .text {
            max-width: 96%;
            font-size: 0.9rem;
            overflow-wrap: anywhere;
        }

        .text.ai {
            padding: 0.75rem 0.25rem 0.4rem;
        }

        .message-content {
            min-width: 0;
            overflow-wrap: anywhere;
        }

        .input-area {
            padding: 0 0.65rem max(0.65rem, env(safe-area-inset-bottom));
        }

        .input {
            gap: 0.4rem;
            padding: 0.35rem;
        }

        .input input {
            font-size: 16px;
        }

        .input-disclaimer {
            padding: 0 0.25rem;
            line-height: 1.35;
        }
    }

    @media (max-width: 400px) {
        .chat-header small {
            font-size: 0.7rem;
        }

        .header-status small {
            display: none;
        }

        .textLogs {
            padding-right: 0.6rem;
            padding-left: 0.6rem;
        }

        .input-area {
            padding-right: 0.5rem;
            padding-left: 0.5rem;
        }
    }
</style>