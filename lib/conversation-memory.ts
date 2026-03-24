/**
 * Conversation memory management with localStorage persistence
 */

import { ChatMessage } from './types';

const STORAGE_KEY = 'dodge-ai-conversations';
const ACTIVE_CONVERSATION_KEY = 'dodge-ai-active-conversation';
const MAX_CONVERSATIONS = 10;
const MAX_MESSAGES_PER_CONVERSATION = 100;

export interface ConversationSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  metadata?: {
    nodeHighlights?: string[];
    lastQuery?: string;
    entityTypes?: string[];
  };
}

/**
 * Save a conversation session to localStorage
 */
export function saveConversation(session: ConversationSession): void {
  try {
    const conversations = getAllConversations();

    // Update or add conversation
    const index = conversations.findIndex(c => c.id === session.id);
    if (index >= 0) {
      conversations[index] = session;
    } else {
      conversations.push(session);
    }

    // Keep only recent conversations
    if (conversations.length > MAX_CONVERSATIONS) {
      conversations.sort((a, b) => b.updatedAt - a.updatedAt);
      conversations.splice(MAX_CONVERSATIONS);
    }

    // Limit messages per conversation
    session.messages = session.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch (err) {
    console.warn('Failed to save conversation:', err);
  }
}

/**
 * Load a specific conversation from localStorage
 */
export function loadConversation(conversationId: string): ConversationSession | null {
  try {
    const conversations = getAllConversations();
    return conversations.find(c => c.id === conversationId) || null;
  } catch (err) {
    console.warn('Failed to load conversation:', err);
    return null;
  }
}

/**
 * Get all saved conversations
 */
export function getAllConversations(): ConversationSession[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.warn('Failed to retrieve conversations:', err);
    return [];
  }
}

/**
 * Delete a conversation
 */
export function deleteConversation(conversationId: string): void {
  try {
    const conversations = getAllConversations();
    const filtered = conversations.filter(c => c.id !== conversationId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));

    // Clear active if it was the deleted one
    if (getActiveConversationId() === conversationId) {
      clearActiveConversation();
    }
  } catch (err) {
    console.warn('Failed to delete conversation:', err);
  }
}

/**
 * Clear all conversations
 */
export function clearAllConversations(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    clearActiveConversation();
  } catch (err) {
    console.warn('Failed to clear conversations:', err);
  }
}

/**
 * Set the active conversation ID
 */
export function setActiveConversationId(conversationId: string): void {
  try {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
  } catch (err) {
    console.warn('Failed to set active conversation:', err);
  }
}

/**
 * Get the active conversation ID
 */
export function getActiveConversationId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  } catch (err) {
    console.warn('Failed to get active conversation:', err);
    return null;
  }
}

/**
 * Clear the active conversation
 */
export function clearActiveConversation(): void {
  try {
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch (err) {
    console.warn('Failed to clear active conversation:', err);
  }
}

/**
 * Generate a conversation title from messages
 */
export function generateConversationTitle(messages: ChatMessage[]): string {
  if (messages.length === 0) return 'New Conversation';

  // Find first user message
  const firstUserMsg = messages.find(m => m.role === 'user');
  if (!firstUserMsg) return 'New Conversation';

  // Truncate to 50 chars and add ellipsis if needed
  const text = firstUserMsg.content;
  if (text.length > 50) {
    return text.substring(0, 47) + '...';
  }

  return text;
}

/**
 * Create a new conversation session
 */
export function createConversationSession(initialMessages: ChatMessage[] = []): ConversationSession {
  const now = Date.now();
  return {
    id: `conv-${now}-${Math.random().toString(36).substring(2, 11)}`,
    title: generateConversationTitle(initialMessages),
    messages: initialMessages,
    createdAt: now,
    updatedAt: now,
    metadata: {
      nodeHighlights: [],
      lastQuery: '',
      entityTypes: [],
    },
  };
}

/**
 * Export conversation as JSON for download
 */
export function exportConversation(conversation: ConversationSession): string {
  return JSON.stringify(conversation, null, 2);
}

/**
 * Import conversation from JSON
 */
export function importConversation(jsonData: string): ConversationSession | null {
  try {
    const data = JSON.parse(jsonData);
    if (!data.id || !data.messages) {
      return null;
    }
    saveConversation(data);
    return data as ConversationSession;
  } catch (err) {
    console.warn('Failed to import conversation:', err);
    return null;
  }
}
