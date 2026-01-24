import { Routes, Route, NavLink } from 'react-router-dom';
import {
  DashboardIcon,
  ImageIcon,
  PersonIcon,
  CubeIcon,
  MixerHorizontalIcon,
  GlobeIcon,
  LayersIcon,
  GearIcon
} from '@radix-ui/react-icons';

// Placeholder page components
function Dashboard() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-display font-bold text-parchment-100 mb-4">Dashboard</h1>
      <p className="text-parchment-300">Overview of all AI-generated assets and generation status.</p>
    </div>
  );
}

function Tiles() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-display font-bold text-parchment-100 mb-4">Tiles</h1>
      <p className="text-parchment-300">Manage battle terrain tiles (floors, walls, slopes) across biomes.</p>
    </div>
  );
}

function Portraits() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-display font-bold text-parchment-100 mb-4">Portraits</h1>
      <p className="text-parchment-300">Character and enemy portrait management.</p>
    </div>
  );
}

function Items() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-display font-bold text-parchment-100 mb-4">Items</h1>
      <p className="text-parchment-300">Equipment, weapons, armor, and consumable item sprites.</p>
    </div>
  );
}

function Icons() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-display font-bold text-parchment-100 mb-4">Icons</h1>
      <p className="text-parchment-300">UI action icons and status effect indicators.</p>
    </div>
  );
}

function Nodes() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-display font-bold text-parchment-100 mb-4">Nodes</h1>
      <p className="text-parchment-300">World map location node icons.</p>
    </div>
  );
}

function Overlays() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-display font-bold text-parchment-100 mb-4">Overlays</h1>
      <p className="text-parchment-300">Environmental overlays and decorative elements.</p>
    </div>
  );
}

function Settings() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-display font-bold text-parchment-100 mb-4">Settings</h1>
      <p className="text-parchment-300">API configuration and generation preferences.</p>
    </div>
  );
}

// Navigation items configuration
const navItems = [
  { to: '/', icon: DashboardIcon, label: 'Dashboard' },
  { to: '/tiles', icon: ImageIcon, label: 'Tiles' },
  { to: '/portraits', icon: PersonIcon, label: 'Portraits' },
  { to: '/items', icon: CubeIcon, label: 'Items' },
  { to: '/icons', icon: MixerHorizontalIcon, label: 'Icons' },
  { to: '/nodes', icon: GlobeIcon, label: 'Nodes' },
  { to: '/overlays', icon: LayersIcon, label: 'Overlays' },
  { to: '/settings', icon: GearIcon, label: 'Settings' }
];

function Sidebar() {
  return (
    <aside className="w-64 bg-midnight-900 border-r border-midnight-700 flex flex-col">
      {/* Logo/Title */}
      <div className="p-6 border-b border-midnight-700">
        <h1 className="text-xl font-display font-bold text-accent-gold">Modia</h1>
        <p className="text-sm text-parchment-400">Asset Manager</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-midnight-700 text-accent-gold'
                      : 'text-parchment-300 hover:bg-midnight-800 hover:text-parchment-100'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-midnight-700">
        <p className="text-xs text-parchment-500 text-center">
          Development Only
        </p>
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-midnight-950">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tiles" element={<Tiles />} />
          <Route path="/portraits" element={<Portraits />} />
          <Route path="/items" element={<Items />} />
          <Route path="/icons" element={<Icons />} />
          <Route path="/nodes" element={<Nodes />} />
          <Route path="/overlays" element={<Overlays />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
