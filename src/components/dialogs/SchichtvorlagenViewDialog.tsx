import type { Schichtvorlagen, StandorteAbteilungen } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { IconPencil } from '@tabler/icons-react';

interface SchichtvorlagenViewDialogProps {
  open: boolean;
  onClose: () => void;
  record: Schichtvorlagen | null;
  onEdit: (record: Schichtvorlagen) => void;
  standorte_abteilungenList: StandorteAbteilungen[];
}

export function SchichtvorlagenViewDialog({ open, onClose, record, onEdit, standorte_abteilungenList }: SchichtvorlagenViewDialogProps) {
  function getStandorteAbteilungenDisplayName(url?: unknown) {
    if (!url) return '—';
    const id = extractRecordId(url);
    return standorte_abteilungenList.find(r => r.record_id === id)?.fields.standort_name ?? '—';
  }

  if (!record) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schichtvorlagen anzeigen</DialogTitle>
        </DialogHeader>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => { onClose(); onEdit(record); }}>
            <IconPencil className="h-3.5 w-3.5 mr-1.5" />
            Bearbeiten
          </Button>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Schichtname</Label>
            <p className="text-sm">{record.fields.schicht_name ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Kürzel</Label>
            <p className="text-sm">{record.fields.schicht_kuerzel ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Schichtbeginn (Uhrzeit)</Label>
            <p className="text-sm">{record.fields.schicht_beginn ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Schichtende (Uhrzeit)</Label>
            <p className="text-sm">{record.fields.schicht_ende ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Pausendauer (Minuten)</Label>
            <p className="text-sm">{record.fields.pausendauer ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Kategorie</Label>
            <Badge variant="secondary">{record.fields.schicht_kategorie?.label ?? '—'}</Badge>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Abteilung</Label>
            <p className="text-sm">{getStandorteAbteilungenDisplayName(record.fields.schicht_abteilung_ref)}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Beschreibung</Label>
            <p className="text-sm whitespace-pre-wrap">{record.fields.schicht_beschreibung ?? '—'}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}