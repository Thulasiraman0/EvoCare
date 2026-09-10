import React, { useState, useEffect } from 'react';
import { Dashboard } from './pages/Dashboard';
import { LoginPage } from './pages/LoginPage';
import { PatientPortal } from './pages/PatientPortal';
import { PlaceholderPortal } from './pages/PlaceholderPortal';
import { authService, AuthUser } from './services/auth';

export const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // On mount, check if a valid session already exists
    const stored = authService.getUser();
    const token = authService.getToken();
    if (stored && token) {
      setUser(stored);
    }
    setChecking(false);

    // Listen for global 401 events from api.ts
    const onUnauthorized = () => setUser(null);
    window.addEventListener('evocare:unauthorized', onUnauthorized);
    return () => window.removeEventListener('evocare:unauthorized', onUnauthorized);
  }, []);

  const handleLoginSuccess = (loggedInUser: AuthUser) => {
    setUser(loggedInUser);
  };

  const handleLogout = async () => {
    await authService.logout();
    setUser(null);
  };

  if (checking) {
    return null; // Brief flash while checking localStorage
  }

  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // Role-based workspace routing
  switch (user.role) {
    case 'DOCTOR':
      return <Dashboard user={user} onLogout={handleLogout} />;
    case 'PATIENT':
      return <PatientPortal user={user} onLogout={handleLogout} />;
    case 'CAREGIVER':
    case 'ADMIN':
      // Dedicated consoles are planned for the next phase;
      // auth + RBAC are already fully enforced for these roles.
      return <PlaceholderPortal user={user} onLogout={handleLogout} />;
    default:
      return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }
};

export default App;
