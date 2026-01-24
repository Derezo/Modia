/**
 * KeyboardShortcutsHelp - Shows available keyboard shortcuts
 * Displays as a dropdown menu triggered by a keyboard icon button
 */

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { KeyboardIcon } from '@radix-ui/react-icons';

/**
 * Keyboard shortcut data organized by category
 */
const SHORTCUTS = [
  {
    category: 'Navigation',
    shortcuts: [
      { key: '1-6', description: 'Switch category tabs' },
      { key: '/', description: 'Focus search input' },
      { key: 'Esc', description: 'Close panel / clear selection' },
    ],
  },
  {
    category: 'Actions',
    shortcuts: [
      { key: 'a', description: 'Select all visible assets' },
      { key: 'g', description: 'Generate selected assets' },
      { key: 'e', description: 'Edit selected asset prompt' },
    ],
  },
];

/**
 * Keyboard key badge component
 */
function KeyBadge({ children }) {
  return (
    <kbd className="px-2 py-1 text-xs font-mono bg-midnight-700 border border-midnight-600 rounded text-parchment-200">
      {children}
    </kbd>
  );
}

export default function KeyboardShortcutsHelp() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="p-2 text-parchment-400 hover:text-parchment-200 hover:bg-midnight-800 rounded-lg transition-colors"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
        >
          <KeyboardIcon className="w-5 h-5" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="w-72 bg-midnight-900 border border-midnight-700 rounded-lg shadow-xl z-50 p-4"
          side="bottom"
          align="end"
          sideOffset={8}
        >
          <h3 className="text-sm font-display font-semibold text-parchment-100 mb-4">
            Keyboard Shortcuts
          </h3>

          {SHORTCUTS.map((group, groupIndex) => (
            <div key={group.category}>
              {groupIndex > 0 && (
                <DropdownMenu.Separator className="h-px bg-midnight-700 my-3" />
              )}
              <DropdownMenu.Label className="text-xs font-medium text-parchment-500 uppercase tracking-wider mb-2">
                {group.category}
              </DropdownMenu.Label>
              {group.shortcuts.map((shortcut) => (
                <DropdownMenu.Item
                  key={shortcut.key}
                  className="flex items-center justify-between gap-4 py-1.5 px-1 rounded outline-none cursor-default"
                  onSelect={(e) => e.preventDefault()}
                >
                  <span className="text-sm text-parchment-300">
                    {shortcut.description}
                  </span>
                  <KeyBadge>{shortcut.key}</KeyBadge>
                </DropdownMenu.Item>
              ))}
            </div>
          ))}

          <DropdownMenu.Arrow className="fill-midnight-700" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
