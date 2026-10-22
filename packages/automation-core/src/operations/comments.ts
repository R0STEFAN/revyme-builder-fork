// packages/automation-core/src/operations/comments.ts
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Operation, FileChange, Snapshot, OperationContext } from '../contracts';
import { defaultRegistry } from '../registry';
import { projectFS } from '@/code/project/project-fs';
import {
  COMMENTS_FILE_PATH,
  parseComments,
  serializeComments,
  type Comment,
} from '@/code/project/comments-config';
import { syncProjectSnapshotToProjectFS } from './projects';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ─── 1. comments.list ─────────────────────────────────────────────────────────

export const commentsListInputSchema = z.object({
  filePath: z.string().optional(),
});
export type CommentsListInput = z.infer<typeof commentsListInputSchema>;

export interface CommentReply {
  id: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface CommentItem {
  id: string;
  filePath: string;
  nodeId?: string;
  position?: { x: number; y: number };
  author: string;
  content: string;
  resolved: boolean;
  replies: CommentReply[];
  createdAt: string;
}

export interface CommentsListOutput {
  comments: CommentItem[];
}

export const commentsListOperation: Operation<CommentsListInput, CommentsListOutput> = {
  name: 'comments.list',
  description: 'List comments across the project or scoped to a specific file with replies and resolved status',
  category: 'comments',
  kind: 'read',
  permit: 'read',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: commentsListInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);

    const json = projectFS.readFile(COMMENTS_FILE_PATH);
    const allComments = parseComments(json);

    const filtered = input.filePath
      ? allComments.filter((c) => c.filePath === input.filePath)
      : allComments;

    const comments: CommentItem[] = filtered.map((c) => ({
      id: c.id,
      filePath: c.filePath,
      nodeId: (c as any).nodeId || c.componentId || undefined,
      position: c.x !== undefined && c.y !== undefined ? { x: c.x, y: c.y } : undefined,
      author: c.authorName || c.authorId || 'AI Agent',
      content: c.text,
      resolved: Boolean(c.resolved),
      replies: (c.messages ?? []).slice(1).map((m) => ({
        id: m.id,
        author: m.authorName || m.authorId || 'Anonymous',
        content: m.text,
        createdAt: typeof m.createdAt === 'number' ? new Date(m.createdAt).toISOString() : String(m.createdAt),
      })),
      createdAt: typeof c.createdAt === 'number' ? new Date(c.createdAt).toISOString() : String(c.createdAt),
    }));

    context?.trace?.('comments:list', { count: comments.length, filter: input.filePath });

    return { comments };
  },
};

// ─── 2. comments.create ───────────────────────────────────────────────────────

export const commentsCreateInputSchema = z.object({
  filePath: z.string().min(1, 'Target file path must not be empty'),
  nodeId: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  content: z.string().min(1, 'Comment content must not be empty'),
  author: z.string().optional().default('AI Agent'),
});
export type CommentsCreateInput = z.input<typeof commentsCreateInputSchema>;

export interface CommentsCreateOutput {
  commentId: string;
  changes: FileChange[];
}

export const commentsCreateOperation: Operation<CommentsCreateInput, CommentsCreateOutput> = {
  name: 'comments.create',
  description: 'Create a new canvas- or node-anchored comment thread',
  category: 'comments',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: commentsCreateInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);

    const targetFile = input.filePath.trim();
    if (projectFS.readFile(targetFile) === null) {
      throw new Error(`FILE_NOT_FOUND: Target file "${targetFile}" does not exist.`);
    }

    const beforeRaw = projectFS.readFile(COMMENTS_FILE_PATH);
    const beforeHash = beforeRaw !== null ? sha256(beforeRaw) : null;
    const existingComments = parseComments(beforeRaw);

    const commentId = context?.createId
      ? context.createId('comment')
      : `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const msgId = context?.createId
      ? context.createId('msg')
      : `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const now = Date.now();
    const author = input.author || 'AI Agent';

    const newComment: Comment = {
      id: commentId,
      x: input.position?.x ?? 0,
      y: input.position?.y ?? 0,
      text: input.content,
      createdAt: now,
      resolved: false,
      color: '#3b82f6',
      filePath: targetFile,
      componentId: input.nodeId,
      authorId: author,
      authorName: author,
      messages: [
        {
          id: msgId,
          text: input.content,
          authorId: author,
          authorName: author,
          createdAt: now,
        },
      ],
    };
    if (input.nodeId) {
      (newComment as any).nodeId = input.nodeId;
    }

    existingComments.push(newComment);
    const newContent = serializeComments(existingComments);
    projectFS.writeFile(COMMENTS_FILE_PATH, newContent);

    const changes: FileChange[] = [
      {
        path: COMMENTS_FILE_PATH,
        beforeHash,
        content: newContent,
      },
    ];

    context?.trace?.('comments:create', { commentId, filePath: targetFile });

    return {
      commentId,
      changes,
    };
  },
};

// ─── 3. comments.resolve ──────────────────────────────────────────────────────

export const commentsResolveInputSchema = z.object({
  commentId: z.string().min(1, 'Comment ID must not be empty'),
  resolved: z.boolean().default(true),
});
export type CommentsResolveInput = z.input<typeof commentsResolveInputSchema>;

export interface CommentsResolveOutput {
  commentId: string;
  resolved: boolean;
  changes: FileChange[];
}

export const commentsResolveOperation: Operation<CommentsResolveInput, CommentsResolveOutput> = {
  name: 'comments.resolve',
  description: 'Resolve or unresolve a comment thread by ID',
  category: 'comments',
  kind: 'mutation',
  permit: 'write',
  environment: 'headless',
  ownerTask: 'T21',
  inputSchema: commentsResolveInputSchema,
  async execute(snapshot, input, context: OperationContext) {
    syncProjectSnapshotToProjectFS(snapshot);

    const beforeRaw = projectFS.readFile(COMMENTS_FILE_PATH);
    const beforeHash = beforeRaw !== null ? sha256(beforeRaw) : null;
    const existingComments = parseComments(beforeRaw);

    const target = existingComments.find((c) => c.id === input.commentId);
    if (!target) {
      throw new Error(`Comment "${input.commentId}" not found.`);
    }

    const resolvedStatus = input.resolved ?? true;
    target.resolved = resolvedStatus;

    const newContent = serializeComments(existingComments);
    projectFS.writeFile(COMMENTS_FILE_PATH, newContent);

    const changes: FileChange[] = [
      {
        path: COMMENTS_FILE_PATH,
        beforeHash,
        content: newContent,
      },
    ];

    context?.trace?.('comments:resolve', { commentId: input.commentId, resolved: resolvedStatus });

    return {
      commentId: input.commentId,
      resolved: resolvedStatus,
      changes,
    };
  },
};

// ─── Registry Registration & Aliases ─────────────────────────────────────────

defaultRegistry.register(commentsListOperation);
defaultRegistry.register(commentsCreateOperation);
defaultRegistry.register(commentsResolveOperation);

defaultRegistry.registerAlias('comments.add', 'comments.create');
defaultRegistry.registerAlias('comments.toggleResolved', 'comments.resolve');
