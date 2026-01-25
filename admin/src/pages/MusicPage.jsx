/**
 * MusicPage - Music tracks management page
 * Displays music tracks from Suno with waveform visualization,
 * variant selection, and generation queue management.
 */

import { AudioGrid } from '../components/audio';
import { SpeakerLoudIcon } from '@radix-ui/react-icons';

export default function MusicPage() {
  return (
    <AudioGrid
      audioType="music"
      pageTitle="Music Tracks"
      pageDescription="Manage regional themes, battle music, and core tracks"
      pageIcon={SpeakerLoudIcon}
      showVariants={true}
      showPollingStatus={true}
    />
  );
}
