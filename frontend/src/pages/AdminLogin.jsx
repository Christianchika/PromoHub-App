import React from 'react';
import Login from './Login';

export default function AdminLogin({ onLoginSuccess, onSwitchToUserLogin }) {
	return <Login isAdminLogin onLoginSuccess={onLoginSuccess} onSwitchToUserLogin={onSwitchToUserLogin} />;
}
