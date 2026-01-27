/**
 * EditableField - Inline editable text field component
 *
 * Displays a value with click-to-edit functionality.
 * Supports both single-line and multiline (textarea) modes.
 */

import { useState } from 'react';
import { Pencil1Icon, CheckIcon, Cross2Icon } from '@radix-ui/react-icons';

/**
 * Editable text field with inline editing
 * @param {object} props
 * @param {string} props.label - Field label
 * @param {string} props.value - Current value
 * @param {function} props.onChange - Callback when value is saved
 * @param {boolean} [props.multiline=false] - Use textarea instead of input
 * @param {string} [props.placeholder=''] - Placeholder text
 * @param {string} [props.hint=''] - Help text below the field
 */
export function EditableField({ label, value, onChange, multiline = false, placeholder = '', hint = '' }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || '');

  const handleStartEdit = () => {
    setEditValue(value || ''); // Sync with current prop value when entering edit mode
    setIsEditing(true);
  };

  const handleSave = () => {
    onChange(editValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value || '');
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !multiline) {
      handleSave();
    }
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    const InputComponent = multiline ? 'textarea' : 'input';
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-parchment-300">{label}</label>
        <div className="flex gap-2">
          <InputComponent
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className={`flex-1 px-3 py-2 bg-midnight-800 border border-midnight-600 rounded-lg
                       text-parchment-100 placeholder-parchment-500
                       focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30
                       ${multiline ? 'min-h-[100px] resize-y' : ''}`}
            autoFocus
          />
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleSave}
              className="p-2 bg-accent-emerald/20 text-accent-emerald rounded-lg hover:bg-accent-emerald/30"
              aria-label="Save"
            >
              <CheckIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="p-2 bg-accent-ruby/20 text-accent-ruby rounded-lg hover:bg-accent-ruby/30"
              aria-label="Cancel"
            >
              <Cross2Icon className="w-4 h-4" />
            </button>
          </div>
        </div>
        {hint && <p className="text-xs text-parchment-500">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-parchment-300">{label}</label>
      <button
        type="button"
        onClick={handleStartEdit}
        className="w-full text-left px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                   text-parchment-200 hover:border-midnight-600 hover:bg-midnight-750
                   transition-colors group flex items-start gap-2"
      >
        <span className={`flex-1 ${multiline ? 'whitespace-pre-wrap' : 'truncate'}`}>
          {value || <span className="text-parchment-500 italic">{placeholder || 'Click to edit...'}</span>}
        </span>
        <Pencil1Icon className="w-4 h-4 text-parchment-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
      </button>
      {hint && <p className="text-xs text-parchment-500">{hint}</p>}
    </div>
  );
}

export default EditableField;
