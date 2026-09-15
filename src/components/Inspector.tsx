import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  GitBranch,
  RefreshCw,
  X,
  ArrowLeft,
  Link2,
  Loader2,
} from 'lucide-react';
import type { FileEntry, FilePreview, GitStatus, Project } from '../shared/types';
import { useT } from '../lib/i18n';
import { request } from '../lib/useDesk';

function FolderContents({
  project,
  folder = '',
  depth = 0,
  onFile,
  onError,
}: {
  project: Project;
  folder?: string;
  depth?: number;
  onFile: (file: string) => void;
  onError: (e: unknown) => void;
}) {
  const t = useT(),
    [entries, setEntries] = useState<FileEntry[]>([]),
    [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true),
    [truncated, setTruncated] = useState(false);
  useEffect(() => {
    let live = true;
    request<{ entries: FileEntry[]; truncated: boolean }>('file.list', {
      projectId: project.id,
      path: folder,
    })
      .then((r) => {
        if (live) {
          setEntries(r.entries);
          setTruncated(r.truncated);
        }
      })
      .catch(onError)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [project.id, folder, onError]);
  if (loading)
    return (
      <div className="tree-loading">
        <Loader2 size={14} className="spin" />
      </div>
    );
  return (
    <>
      {entries.map((entry) => (
        <div key={entry.path}>
          <button
            className="file-row"
            style={{ paddingLeft: 14 + depth * 14 }}
            title={entry.path}
            onClick={() => {
              if (!entry.directory) onFile(entry.path);
              else
                setExpanded((old) => {
                  const next = new Set(old);
                  if (next.has(entry.path)) next.delete(entry.path);
                  else next.add(entry.path);
                  return next;
                });
            }}
          >
            {entry.directory ? (
              <ChevronRight size={12} className={expanded.has(entry.path) ? 'rotated' : ''} />
            ) : (
              <span className="tree-spacer" />
            )}
            {entry.symlink ? (
              <Link2 size={14} />
            ) : entry.directory ? (
              expanded.has(entry.path) ? (
                <FolderOpen size={15} />
              ) : (
                <Folder size={15} />
              )
            ) : (
              <File size={14} className="file-icon" />
            )}
            <span>{entry.name}</span>
          </button>
          {entry.directory && expanded.has(entry.path) && (
            <FolderContents
              project={project}
              folder={entry.path}
              depth={depth + 1}
              onFile={onFile}
              onError={onError}
            />
          )}
        </div>
      ))}
      {!entries.length && <p className="tree-empty">{t('空文件夹', 'Empty folder')}</p>}
      {truncated && <p className="tree-empty">{t('仅显示前 500 项', 'Showing the first 500 entries')}</p>}
    </>
  );
}
export function Inspector({
  project,
  refreshKey,
  onClose,
  onError,
  onMention,
}: {
  project?: Project;
  refreshKey: string;
  onClose: () => void;
  onError: (e: unknown) => void;
  onMention: (file: string) => void;
}) {
  const t = useT(),
    [tab, setTab] = useState<'files' | 'changes'>('files');
  const [git, setGit] = useState<GitStatus | null>(null),
    [preview, setPreview] = useState<FilePreview | null>(null);
  const [diff, setDiff] = useState(false),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const [treeKey, setTreeKey] = useState(0);
  const previewRequest = useRef(0);
  const previewLines = preview?.content.split('\n') ?? [];
  function clearPreview() {
    ++previewRequest.current;
    setLoading(false);
    setPreview(null);
  }
  useEffect(() => {
    clearPreview();
    setGit(null);
    return () => {
      ++previewRequest.current;
    };
  }, [project?.id]);
  useEffect(() => {
    if (!project) return;
    let live = true;
    request<GitStatus>('git.status', { projectId: project.id })
      .then((r) => {
        if (live) setGit(r);
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [project?.id, revision, refreshKey, onError]);
  async function showFile(file: string, asDiff = false) {
    if (!project) return;
    const generation = ++previewRequest.current;
    setLoading(true);
    setDiff(asDiff);
    try {
      const result = await request<FilePreview>(asDiff ? 'git.diff' : 'file.read', {
        projectId: project.id,
        path: file,
      });
      if (generation === previewRequest.current) setPreview({ ...result, path: file });
    } catch (e) {
      if (generation === previewRequest.current) onError(e);
    } finally {
      if (generation === previewRequest.current) setLoading(false);
    }
  }
  return (
    <aside className="inspector" aria-label={t('项目面板', 'Project inspector')}>
      <div className="inspector-heading">
        <span>{t('工作区', 'Workspace')}</span>
        <div className="row">
          <button
            className="icon-button"
            aria-label={t('刷新文件', 'Refresh files')}
            onClick={() => {
              setRevision((r) => r + 1);
              setTreeKey((k) => k + 1);
              clearPreview();
            }}
          >
            <RefreshCw size={14} />
          </button>
          <button className="icon-button" aria-label={t('关闭项目面板', 'Close inspector')} onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </div>
      {project ? (
        <>
          <div className="inspector-project">
            <FolderOpen size={16} />
            <strong>{project.name}</strong>
            {git?.isRepo && (
              <span className="branch">
                <GitBranch size={12} />
                {git.branch}
              </span>
            )}
          </div>
          <div className="inspector-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'files'}
              className={tab === 'files' ? 'active' : ''}
              onClick={() => {
                setTab('files');
                clearPreview();
              }}
            >
              {t('文件', 'Files')}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'changes'}
              className={tab === 'changes' ? 'active' : ''}
              onClick={() => {
                setTab('changes');
                clearPreview();
              }}
            >
              {t('更改', 'Changes')}
              <span className="count">{git?.files.length ?? 0}</span>
            </button>
          </div>
          {loading ? (
            <div className="inspector-empty">
              <Loader2 className="spin" size={20} />
            </div>
          ) : preview ? (
            <div className="file-preview">
              <div className="preview-heading">
                <button
                  className="icon-button"
                  onClick={clearPreview}
                  aria-label={t('返回文件列表', 'Back to files')}
                >
                  <ArrowLeft size={15} />
                </button>
                <span title={preview.path}>{preview.path}</span>
                <button
                  className="text-button"
                  onClick={() => onMention(preview.path)}
                  title={t('添加到提示词', 'Mention in prompt')}
                >
                  @
                </button>
              </div>
              <div className={`code-preview ${diff ? 'diff-preview' : ''}`}>
                <pre>
                  {previewLines.slice(0, 3000).map((line, index) => (
                    <div
                      className={
                        diff
                          ? line.startsWith('+')
                            ? 'line-add'
                            : line.startsWith('-')
                              ? 'line-remove'
                              : line.startsWith('@@')
                                ? 'line-hunk'
                                : ''
                          : ''
                      }
                      key={index}
                    >
                      <span className="line-number">{index + 1}</span>
                      <span>{line || ' '}</span>
                    </div>
                  ))}
                </pre>
                {previewLines.length > 3000 && (
                  <p className="tree-empty">
                    {t('预览仅显示前 3,000 行。', 'Preview shows the first 3,000 lines.')}
                  </p>
                )}
              </div>
            </div>
          ) : tab === 'files' ? (
            <div className="file-tree">
              <FolderContents
                key={`${project.id}:${treeKey}`}
                project={project}
                onFile={(file) => void showFile(file)}
                onError={onError}
              />
            </div>
          ) : (
            <div className="changes-list">
              {git?.isRepo ? (
                <>
                  <div className="change-summary">
                    <span>{t('工作区更改', 'Workspace changes')}</span>
                    <span className="added">+{git.added}</span>
                    <span className="removed">−{git.removed}</span>
                  </div>
                  {git.files.map((file) => (
                    <button
                      key={file.path}
                      className="changed-file"
                      title={file.path}
                      onClick={() => void showFile(file.path, true)}
                    >
                      <File size={14} />
                      <span>{file.path}</span>
                      <b className={file.index === '?' || file.index === 'A' ? 'added' : 'modified'}>
                        {file.index === '?' ? 'U' : file.working !== ' ' ? file.working : file.index}
                      </b>
                    </button>
                  ))}
                  {!git.files.length && (
                    <div className="inspector-empty">
                      <GitBranch size={24} />
                      <p>{t('工作区是干净的', 'Working tree is clean')}</p>
                      <small>
                        {t('Codex 的文件更改会显示在这里。', 'File changes from Codex will appear here.')}
                      </small>
                    </div>
                  )}
                </>
              ) : (
                <div className="inspector-empty">
                  <GitBranch size={24} />
                  <p>{t('这个文件夹不是 Git 仓库', 'This folder is not a Git repository')}</p>
                </div>
              )}
            </div>
          )}
          <div className="inspector-footer">
            <span className="status-dot" />
            {t('本地文件 · 只读预览', 'Local files · Read-only preview')}
          </div>
        </>
      ) : (
        <div className="inspector-empty">
          <FolderOpen size={28} />
          <p>{t('选择一个项目', 'Choose a project')}</p>
          <small>{t('在这里浏览文件与代码更改。', 'Browse its files and code changes here.')}</small>
        </div>
      )}
    </aside>
  );
}
