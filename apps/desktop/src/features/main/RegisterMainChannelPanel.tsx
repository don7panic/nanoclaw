import * as React from 'react';
import { type Dispatch, type SetStateAction } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

import { type StepDraft } from '@/features/shared/setupDraft';
import { type SetupSnapshot } from '@/types';

type Channel = {
  id: string;
  name: string;
  folder: string;
  trigger: string;
  mounts?: Array<{ hostPath: string; containerPath: string; readonly?: boolean }>;
};

interface RegisterMainChannelPanelProps {
  snapshot: SetupSnapshot;
  draft: StepDraft;
  setDraft: Dispatch<SetStateAction<StepDraft>>;
}

export function RegisterMainChannelPanel({
  snapshot,
  draft,
  setDraft,
}: RegisterMainChannelPanelProps): JSX.Element {
  const [allChannels, setAllChannels] = React.useState<Channel[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newChannel, setNewChannel] = React.useState({
    channelId: '',
    name: '',
    folder: '',
    trigger: '@Andy',
  });
  const [error, setError] = React.useState<string | null>(null);
  const [editingMountsFor, setEditingMountsFor] = React.useState<string | null>(null);
  const [mountDraft, setMountDraft] = React.useState<
    Array<{ hostPath: string; containerPath: string; readonly: boolean }>
  >([]);

  // Load channels on mount
  React.useEffect(() => {
    loadChannels();
  }, []);

  const loadChannels = async () => {
    try {
      const response = await fetch('/api/channels/list');
      const data = (await response.json()) as { channels: Channel[] };
      setAllChannels(data.channels);
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  };

  const handleAddChannel = async () => {
    if (!newChannel.channelId || !newChannel.name || !newChannel.folder) {
      setError('Channel ID, Name, and Folder are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/channels/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newChannel),
      });

      const result = (await response.json()) as { success: boolean; error?: string };

      if (result.success) {
        await loadChannels();
        setShowAddForm(false);
        setNewChannel({ channelId: '', name: '', folder: '', trigger: '@Andy' });
      } else {
        setError(result.error || 'Failed to add channel');
      }
    } catch (err) {
      setError('Network error: ' + String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteChannel = async (channelId: string) => {
    if (!confirm(`Delete channel ${channelId}?`)) return;

    setLoading(true);
    try {
      const response = await fetch('/api/channels/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      });

      const result = (await response.json()) as { success: boolean; error?: string };

      if (result.success) {
        await loadChannels();
      } else {
        setError(result.error || 'Failed to delete channel');
      }
    } catch (err) {
      setError('Network error: ' + String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleEditMounts = (channel: Channel) => {
    setEditingMountsFor(channel.id);
    setMountDraft(channel.mounts?.map((m) => ({ ...m, readonly: m.readonly ?? true })) || []);
  };

  const handleSaveMounts = async (channelId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/channels/update-mounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, mounts: mountDraft }),
      });

      const result = (await response.json()) as { success: boolean; error?: string };

      if (result.success) {
        await loadChannels();
        setEditingMountsFor(null);
      } else {
        setError(result.error || 'Failed to update mounts');
      }
    } catch (err) {
      setError('Network error: ' + String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Error Display */}
      {error && (
        <div className="rounded-lg border border-burgundy/40 bg-burgundy/10 px-4 py-3 text-sm text-burgundy">
          {error}
        </div>
      )}

      {/* Main Channel Configuration */}
      {!snapshot.registeredMainChannel.configured && (
        <div className="space-y-4">
          <div>
            <h3 className="font-serif text-base font-medium">Main Channel</h3>
            <p className="text-sm text-muted-foreground">
              Configure your primary Discord channel for NanoClaw control.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="channel-id">Channel ID</Label>
            <Input
              id="channel-id"
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, mainChannelId: event.target.value }))
              }
              placeholder="Leave blank to auto-detect"
              value={draft.mainChannelId}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="channel-name">Group Name</Label>
              <Input
                id="channel-name"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, mainChannelName: event.target.value }))
                }
                placeholder="main"
                value={draft.mainChannelName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="channel-folder">Folder Name</Label>
              <Input
                id="channel-folder"
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, mainChannelFolder: event.target.value }))
                }
                placeholder="main"
                value={draft.mainChannelFolder}
              />
            </div>
          </div>
        </div>
      )}

      {/* Registered Channels List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-base font-medium">
            Registered Channels ({allChannels.length})
          </h3>
          <Button
            disabled={loading}
            onClick={() => setShowAddForm(!showAddForm)}
            size="sm"
            variant={showAddForm ? 'secondary' : 'default'}
          >
            {showAddForm ? 'Cancel' : 'Add Channel'}
          </Button>
        </div>

        {/* Add Channel Form */}
        {showAddForm && (
          <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            <h4 className="text-sm font-medium">New Channel</h4>
            <div className="space-y-2">
              <Label htmlFor="new-channel-id">Channel ID</Label>
              <Input
                id="new-channel-id"
                onChange={(e) =>
                  setNewChannel((prev) => ({ ...prev, channelId: e.target.value }))
                }
                placeholder="123456789..."
                value={newChannel.channelId}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="new-name">Name</Label>
                <Input
                  id="new-name"
                  onChange={(e) =>
                    setNewChannel((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="channel-name"
                  value={newChannel.name}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-folder">Folder</Label>
                <Input
                  id="new-folder"
                  onChange={(e) =>
                    setNewChannel((prev) => ({ ...prev, folder: e.target.value }))
                  }
                  placeholder="folder-name"
                  value={newChannel.folder}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-trigger">Trigger</Label>
                <Input
                  id="new-trigger"
                  onChange={(e) =>
                    setNewChannel((prev) => ({ ...prev, trigger: e.target.value }))
                  }
                  placeholder="@Andy"
                  value={newChannel.trigger}
                />
              </div>
            </div>
            <Button disabled={loading} onClick={handleAddChannel} size="sm">
              {loading ? 'Adding...' : 'Add Channel'}
            </Button>
          </div>
        )}

        {/* Channels List */}
        {allChannels.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No channels registered yet.</p>
        ) : (
          <div className="space-y-3">
            {allChannels.map((channel) => (
              <div
                key={channel.id}
                className="rounded-lg border border-border bg-card p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-foreground">{channel.name}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-mono">ID: {channel.id}</span>
                      <span>Folder: {channel.folder}</span>
                      <span>Trigger: {channel.trigger}</span>
                      <span>Mounts: {channel.mounts?.length || 0}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={loading}
                      onClick={() =>
                        editingMountsFor === channel.id
                          ? setEditingMountsFor(null)
                          : handleEditMounts(channel)
                      }
                      size="sm"
                      variant="outline"
                    >
                      {editingMountsFor === channel.id ? 'Close' : 'Mounts'}
                    </Button>
                    <Button
                      disabled={loading}
                      onClick={() => handleDeleteChannel(channel.id)}
                      size="sm"
                      variant="ghost"
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Mount Editor */}
                {editingMountsFor === channel.id && (
                  <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                    <h5 className="text-xs font-medium uppercase tracking-wider text-navy/80">
                      Configure Mounts
                    </h5>
                    {mountDraft.map((mount, idx) => (
                      <div key={idx} className="flex gap-3 items-start">
                        <div className="flex-1 space-y-2">
                          <Input
                            placeholder="/Users/you/projects/myapp"
                            value={mount.hostPath}
                            onChange={(e) => {
                              const newDraft = [...mountDraft];
                              newDraft[idx].hostPath = e.target.value;
                              setMountDraft(newDraft);
                            }}
                          />
                          <div className="flex gap-3 items-center">
                            <Input
                              className="flex-1"
                              placeholder="myapp"
                              value={mount.containerPath}
                              onChange={(e) => {
                                const newDraft = [...mountDraft];
                                newDraft[idx].containerPath = e.target.value;
                                setMountDraft(newDraft);
                              }}
                            />
                            <label className="text-xs flex items-center gap-2 whitespace-nowrap text-muted-foreground">
                              <Checkbox
                                checked={mount.readonly}
                                onCheckedChange={(checked) => {
                                  const newDraft = [...mountDraft];
                                  newDraft[idx].readonly = checked === true;
                                  setMountDraft(newDraft);
                                }}
                              />
                              <span>Read-only</span>
                            </label>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setMountDraft(mountDraft.filter((_, i) => i !== idx))}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-3 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setMountDraft([
                            ...mountDraft,
                            { hostPath: '', containerPath: '', readonly: true },
                          ])
                        }
                      >
                        Add Mount
                      </Button>
                      <Button
                        size="sm"
                        disabled={loading}
                        onClick={() => handleSaveMounts(channel.id)}
                      >
                        {loading ? 'Saving...' : 'Save Mounts'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
