import { useState, useMemo, useRef } from 'react';
import { IconPlayerPlay, IconCode, IconTrash, IconFile, IconFileTypePdf, IconPhoto, IconDownload, IconBolt, IconChevronLeft, IconChevronRight, IconArrowsSort, IconChevronDown } from '@tabler/icons-react';
import { useActions } from '@/context/ActionsContext';
import type { Action, FileAttachment } from '@/lib/actions-agent';

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === 'application/pdf') return <IconFileTypePdf size={14} className="shrink-0 text-red-500" />;
  if (mimeType.startsWith('image/')) return <IconPhoto size={14} className="shrink-0 text-blue-500" />;
  return <IconFile size={14} className="shrink-0 text-muted-foreground" />;
}

type FileSortMode = 'newest' | 'oldest' | 'az' | 'za';
const FILE_SORT_LABELS: Record<FileSortMode, string> = {
  newest: 'Neuste zuerst',
  oldest: 'Älteste zuerst',
  az: 'Name A→Z',
  za: 'Name Z→A',
};

const PAGE_SIZE = 8;

function FileList({ files, onDownload }: { files: FileAttachment[]; onDownload: (url: string, filename: string) => void }) {
  const [fileSort, setFileSort] = useState<FileSortMode>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    setPage(0);
    return [...files].sort((a, b) => {
      switch (fileSort) {
        case 'newest': return b.created_at.localeCompare(a.created_at);
        case 'oldest': return a.created_at.localeCompare(b.created_at);
        case 'az': return a.filename.localeCompare(b.filename);
        case 'za': return b.filename.localeCompare(a.filename);
      }
    });
  }, [files, fileSort]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageFiles = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="mt-3">
      <div className="-mx-1">
        <div className="flex items-center justify-end py-1">
          <div className="flex-1 border-b border-border" />
          <div className="relative">
            <button
              onClick={() => setSortOpen(o => !o)}
              className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                sortOpen ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <IconArrowsSort size={14} />
            </button>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded-lg shadow-lg py-1 min-w-32">
                  {(['newest', 'oldest', 'az', 'za'] as FileSortMode[]).map(mode => (
                    <button
                      key={mode}
                      onClick={() => { setFileSort(mode); setSortOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        fileSort === mode ? 'text-primary font-medium bg-primary/5' : 'text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {FILE_SORT_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        {pageFiles.map(f => (
          <button
            key={f.identifier}
            onClick={() => onDownload(f.url, f.filename)}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg hover:bg-accent text-left transition-colors"
          >
            <FileIcon mimeType={f.mime_type} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-muted-foreground truncate">{f.filename}</div>
            </div>
            <IconDownload size={14} className="shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2 pt-2 border-t">
          <button
            onClick={() => setPage(p => p - 1)}
            disabled={page === 0}
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <IconChevronLeft size={14} />
          </button>
          <span className="text-xs text-muted-foreground">{page + 1} / {totalPages}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= totalPages - 1}
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-accent text-muted-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <IconChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function ActionWidget({ action, files, onRun, onShowCode, onDelete, onDownload, devMode }: {
  action: Action;
  files: FileAttachment[];
  onRun: (action: Action) => void;
  onShowCode: (action: Action) => void;
  onDelete: (action: Action) => Promise<void>;
  onDownload: (url: string, filename: string) => void;
  devMode: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (expanded && contentRef.current) contentRef.current.style.overflow = 'hidden';
    setExpanded(e => !e);
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <button
        onClick={toggle}
        className="flex items-center justify-between gap-2 w-full p-4 sm:p-6 text-left hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <IconBolt size={18} className="shrink-0 text-muted-foreground" />
          <p className="font-semibold text-foreground truncate">{action.title || action.identifier}</p>
        </div>
        <IconChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        onTransitionEnd={(e) => { if (e.target === e.currentTarget && expanded && contentRef.current) contentRef.current.style.overflow = 'visible'; }}
      >
        <div ref={contentRef} className="overflow-hidden">
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            {devMode && <div className="text-xs text-muted-foreground font-mono mb-1 truncate">{action.identifier}</div>}
            {action.description && <p className="text-xs text-muted-foreground mb-3">{action.description}</p>}
            <div className="flex gap-1">
              <button
                onClick={() => onRun(action)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <IconPlayerPlay size={14} />
                Ausführen
              </button>
              {devMode && (
                <button
                  onClick={() => onShowCode(action)}
                  className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-primary/10 text-primary transition-colors"
                  title="Quellcode"
                >
                  <IconCode size={16} />
                </button>
              )}
              <button
                onClick={() => { void onDelete(action); }}
                className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-destructive/10 text-destructive transition-colors"
                title="Löschen"
              >
                <IconTrash size={16} />
              </button>
            </div>
            {files.length > 0 && (
              <FileList files={files} onDownload={onDownload} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilesWidget({ files, onDownload, label }: { files: FileAttachment[]; onDownload: (url: string, filename: string) => void; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (expanded && contentRef.current) contentRef.current.style.overflow = 'hidden';
    setExpanded(e => !e);
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <button
        onClick={toggle}
        className="flex items-center justify-between gap-2 w-full p-4 sm:p-6 text-left hover:bg-accent/50 transition-colors"
      >
        <p className="font-semibold text-foreground truncate">{label}</p>
        <div className="flex items-center gap-1 shrink-0">
          <IconFile size={18} className="text-muted-foreground" />
          <IconChevronDown size={16} className={`text-muted-foreground transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        onTransitionEnd={(e) => { if (e.target === e.currentTarget && expanded && contentRef.current) contentRef.current.style.overflow = 'visible'; }}
      >
        <div ref={contentRef} className="overflow-hidden">
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <p className="text-2xl font-bold">{files.length}</p>
            <FileList files={files} onDownload={onDownload} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ActionsBar() {
  const { actions, runAction, showActionCode, deleteAction, devMode, files, filesByAction, downloadFile } = useActions();

  const unassignedFiles = filesByAction['__unassigned__'] || [];

  if (actions.length === 0 && files.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6 items-start">
      {actions.map(a => (
        <ActionWidget
          key={`${a.app_id}/${a.identifier}`}
          action={a}
          files={filesByAction[a.identifier] || []}
          onRun={runAction}
          onShowCode={showActionCode}
          onDelete={deleteAction}
          onDownload={(url, filename) => { void downloadFile(url, filename); }}
          devMode={devMode}
        />
      ))}
      {unassignedFiles.length > 0 && (
        <FilesWidget
          files={unassignedFiles}
          onDownload={(url, filename) => { void downloadFile(url, filename); }}
          label="Dateien"
        />
      )}
    </div>
  );
}
