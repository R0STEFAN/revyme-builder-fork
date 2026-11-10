import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { AgentCommentPopover } from './AgentCommentPopover';
import {
  agentCommentDialogAtom,
  agentAttachedNodeAtom,
  agentQueuedRequestAtom,
  agentDraftPromptAtom,
} from '@/code/stores/agent-chat-store';
import { leftPanelAtom } from '@/code/stores/left-panel-store';

describe('AgentCommentPopover', () => {
  const store = getDefaultStore();

  beforeEach(() => {
    store.set(agentCommentDialogAtom, null);
    store.set(agentAttachedNodeAtom, null);
    store.set(agentQueuedRequestAtom, null);
    store.set(agentDraftPromptAtom, '');
    store.set(leftPanelAtom, 'layers');
  });

  it('renders nothing when closed', () => {
    const { container } = render(<AgentCommentPopover />);
    expect(container.firstChild).toBeNull();
  });

  it('renders target information and input when open', () => {
    store.set(agentCommentDialogAtom, {
      isOpen: true,
      x: 200,
      y: 150,
      targetNodeId: 'hero-btn-1',
      targetNodeName: 'Get Started Button',
      targetNodeType: 'button',
      targetFilePath: 'app/page.tsx',
      refData: {
        filePath: 'app/page.tsx',
        nodeId: 'hero-btn-1',
        name: 'Get Started Button',
        type: 'button',
      },
    });

    render(<AgentCommentPopover />);
    expect(screen.getByTestId('agent-comment-popover')).toBeTruthy();
    expect(screen.getByText('Get Started Button')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Add comment or instruction for the agent/)).toBeTruthy();
  });

  it('closes when Cancel is clicked', () => {
    store.set(agentCommentDialogAtom, {
      isOpen: true,
      x: 100,
      y: 100,
      targetNodeId: 'test-node',
      targetFilePath: 'app/page.tsx',
      refData: { filePath: 'app/page.tsx', nodeId: 'test-node' },
    });

    render(<AgentCommentPopover />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(store.get(agentCommentDialogAtom)).toBeNull();
  });

  it('attaches to chat when "Attach to Chat" is clicked', () => {
    store.set(agentCommentDialogAtom, {
      isOpen: true,
      x: 100,
      y: 100,
      targetNodeId: 'node-cta',
      targetNodeName: 'CTA Section',
      targetFilePath: 'app/page.tsx',
      refData: { filePath: 'app/page.tsx', nodeId: 'node-cta', name: 'CTA Section' },
    });

    render(<AgentCommentPopover />);
    const textarea = screen.getByPlaceholderText(/Add comment or instruction for the agent/);
    fireEvent.change(textarea, { target: { value: 'Make this bigger' } });
    fireEvent.click(screen.getByText('Attach to Chat'));

    expect(store.get(agentAttachedNodeAtom)?.nodeId).toBe('node-cta');
    expect(store.get(agentDraftPromptAtom)).toBe('Make this bigger');
    expect(store.get(leftPanelAtom)).toBe('vibe');
    expect(store.get(agentCommentDialogAtom)).toBeNull();
  });

  it('queues request and opens vibe panel when "Ask Agent" is clicked with comment', () => {
    store.set(agentCommentDialogAtom, {
      isOpen: true,
      x: 100,
      y: 100,
      targetNodeId: 'node-card',
      targetNodeName: 'Hero Card',
      targetFilePath: 'app/page.tsx',
      refData: { filePath: 'app/page.tsx', nodeId: 'node-card', name: 'Hero Card' },
    });

    render(<AgentCommentPopover />);
    const textarea = screen.getByPlaceholderText(/Add comment or instruction for the agent/);
    fireEvent.change(textarea, { target: { value: 'Add gradient background' } });
    fireEvent.click(screen.getByText('Ask Agent'));

    expect(store.get(agentAttachedNodeAtom)?.nodeId).toBe('node-card');
    expect(store.get(agentQueuedRequestAtom)?.text).toBe('Add gradient background');
    expect(store.get(leftPanelAtom)).toBe('vibe');
    expect(store.get(agentCommentDialogAtom)).toBeNull();
  });
});
