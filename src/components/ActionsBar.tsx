import { useState } from 'react';
import { IconPlayerPlay, IconChevronDown } from '@tabler/icons-react';
import { useActions } from '@/context/ActionsContext';

export default function ActionsBar() {
  const { actions, runAction } = useActions();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  if (actions.length === 0) return null;

  return (
    <div className="flex justify-end mb-3">
      {/* Desktop: show all action buttons */}
      <div className="hidden lg:flex flex-wrap gap-2 justify-end">
        {actions.map(a => (
          <button
            key={`${a.app_id}/${a.identifier}`}
            onClick={() => runAction(a)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <IconPlayerPlay size={14} />
            {a.identifier}
          </button>
        ))}
      </div>
      {/* Mobile: single button with dropdown */}
      <div className="lg:hidden relative">
        <button
          onClick={() => setDropdownOpen(o => !o)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          Aktionen ({actions.length})
          <IconChevronDown size={14} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>
        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setDropdownOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-30 bg-card border border-border rounded-xl shadow-lg p-1.5 min-w-52">
              {actions.map(a => (
                <button
                  key={`${a.app_id}/${a.identifier}`}
                  onClick={() => { runAction(a); setDropdownOpen(false); }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-muted transition-colors"
                >
                  <IconPlayerPlay size={14} className="text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.identifier}</div>
                    <div className="text-xs text-muted-foreground truncate">{a.app_name}</div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
