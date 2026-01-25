/**
 * SoundEffectsPage - Sound effects management page
 * Displays SFX from ElevenLabs with waveform visualization,
 * prompt validation, and generation queue management.
 */

import { AudioGrid } from '../components/audio';
import { MixerVerticalIcon } from '@radix-ui/react-icons';

export default function SoundEffectsPage() {
  return (
    <AudioGrid
      audioType="sfx"
      pageTitle="Sound Effects"
      pageDescription="Manage combat, skills, ambient, interactions, and UI sounds"
      pageIcon={MixerVerticalIcon}
      showVariants={false}
      showPollingStatus={false}
    />
  );
}
