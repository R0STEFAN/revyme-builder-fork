import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { AgentCommentPopover } from './AgentCommentPopover';
import {
  agentCommentDialogAtom,
  agentStagedTasksAtom,
} from '@/code/stores/agent-chat-store';
import { leftPanelAtom } from '@/code/stores/left-panel-store';

describe('AgentCommentPopover', () => {
  const store = getDefaultStore();

  beforeEach(() => {
    store.set(agentCommentDialogAtom, null);
    store.set(agentStagedTasksAtom, []);
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
    expect(screen.getByPlaceholderText(/Describe what to change on this element/)).toBeTruthy();
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

  it('stages task when "Add Task" is clicked with comment', () => {
    store.set(agentCommentDialogAtom, {
      isOpen: true,
      x: 100,
      y: 100,
      targetNodeId: 'node-cta',
      targetNodeName: 'CTA Button',
      targetNodeType: 'button',
      targetFilePath: 'app/page.tsx',
      refData: { filePath: 'app/page.tsx', nodeId: 'node-cta', name: 'CTA Button' },
    });

    render(<AgentCommentPopover />);
    const textarea = screen.getByPlaceholderText(/Describe what to change on this element/);
    fireEvent.change(textarea, { target: { value: 'Make this button blue' } });
    fireEvent.click(screen.getByText('Add Task'));

    const staged = store.get(agentStagedTasksAtom);
    expect(staged.length).toBe(1);
    expect(staged[0].nodeId).toBe('node-cta');
    expect(staged[0].comment).toBe('Make this button blue');
    expect(store.get(agentCommentDialogAtom)).toBeNull();
  });

  it('stages task and opens vibe chat when "Add & Open Chat" is clicked', () => {
    store.set(agentCommentDialogAtom, {
      isOpen: true,
      x: 100,
      y: 100,
      targetNodeId: 'node-card',
      targetNodeName: 'Hero Card',
      targetNodeType: 'div',
      targetFilePath: 'app/page.tsx',
      refData: { filePath: 'app/page.tsx', nodeId: 'node-card', name: 'Hero Card' },
    });

    render(<AgentCommentPopover />);
    const textarea = screen.getByPlaceholderText(/Describe what to change on this element/);
    fireEvent.change(textarea, { target: { value: 'Add rounded borders' } });
    fireEvent.click(screen.getByText('Add & Open Chat'));

    const staged = store.get(agentStagedTasksAtom);
    expect(staged.length).toBe(1);
    expect(staged[0].nodeId).toBe('node-card');
    expect(staged[0].comment).toBe('Add rounded borders');
    expect(store.get(leftPanelAtom)).toBe('vibe');
    expect(store.get(agentCommentDialogAtom)).toBeNull();
  });
});
