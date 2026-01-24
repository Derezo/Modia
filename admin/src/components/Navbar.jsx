/**
 * Navbar - Category tabs navigation
 * Horizontal navigation for switching between asset categories
 */

import { NavLink } from 'react-router-dom';
import {
  DashboardIcon,
  ImageIcon,
  PersonIcon,
  CubeIcon,
  MixerHorizontalIcon,
  GlobeIcon,
  LayersIcon,
  GearIcon,
} from '@radix-ui/react-icons';

const navItems = [
  { to: '/', icon: DashboardIcon, label: 'Dashboard', end: true },
  { to: '/tiles', icon: ImageIcon, label: 'Tiles' },
  { to: '/portraits', icon: PersonIcon, label: 'Portraits' },
  { to: '/items', icon: CubeIcon, label: 'Items' },
  { to: '/icons', icon: MixerHorizontalIcon, label: 'Icons' },
  { to: '/nodes', icon: GlobeIcon, label: 'Nodes' },
  { to: '/overlays', icon: LayersIcon, label: 'Overlays' },
  { to: '/settings', icon: GearIcon, label: 'Settings' },
];

export default function Navbar() {
  return (
    <nav className="border-b border-midnight-700 bg-midnight-900/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="px-6">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-accent-gold text-accent-gold'
                    : 'border-transparent text-parchment-400 hover:text-parchment-200 hover:border-midnight-600'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
