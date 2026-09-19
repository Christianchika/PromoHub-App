import React, { useEffect, useState } from 'react';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import DealsList from './pages/DealsList';
import DealDetail from './pages/DealDetail';
import HowItWorks from './pages/HowItWorks';
import InterestedDeals from './pages/InterestedDeals';
import Login from './pages/Login';
import AdminLogin from './pages/AdminLogin';
import Register from './pages/Register';
import MyClaims from './pages/MyClaims';
import AdminDashboard from './pages/AdminDashboard';
import { MOCK_DEALS } from './mockData/deals';
import './styles/global.css';

const AUTH_STORAGE_KEY = 'promohub.currentUser';

const getStoredUser = () => {
  try {
    const storedUser = localStorage.getItem(AUTH_STORAGE_KEY);
    return storedUser ? JSON.parse(storedUser) : null;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
};

export default function App() {
  const [deals, setDeals] = useState(MOCK_DEALS);
  const [currentUser, setCurrentUser] = useState(getStoredUser); // { name, email, is_admin, token }
  const [activeTab, setActiveTab] = useState(() => getStoredUser()?.is_admin ? 'admin' : 'deals'); // 'deals', 'interested', 'my-claims', 'admin', 'login', 'admin-login', 'register', 'how-it-works', 'detail'
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [userClaims, setUserClaims] = useState([]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, [currentUser]);

  useEffect(() => {
    fetch('/api/deals')
      .then(async response => {
        if (!response.ok) throw new Error('Unable to load deals.');
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) throw new Error('Deals service returned an invalid response.');
        return response.json();
      })
      .then(remoteDeals => setDeals(remoteDeals.map(deal => ({
        ...deal,
        price: Number(deal.price),
        original_price: deal.original_price == null ? null : Number(deal.original_price),
        total_stock: Number(deal.total_stock),
        stock_remaining: Number(deal.stock_remaining),
        interested_count: Number(deal.interested_count || 0),
        is_interested: false
      }))))
      .catch(() => {});
  }, []);

  // Handle toggling user interest for a deal
  const handleToggleInterest = (dealId) => {
    setDeals(prevDeals =>
      prevDeals.map(d => {
        if (d.id === dealId) {
          const isNowInterested = !d.is_interested;
          return {
            ...d,
            is_interested: isNowInterested,
            interested_count: d.interested_count + (isNowInterested ? 1 : -1)
          };
        }
        return d;
      })
    );
  };

  // Handle claim voucher addition
  const handleClaimSuccess = (dealId, claimResponse) => {
    const targetDeal = deals.find(d => d.id === dealId);
    if (targetDeal && claimResponse?.deal) {
      const updatedDeal = {
        ...claimResponse.deal,
        price: Number(claimResponse.deal.price),
        original_price: claimResponse.deal.original_price == null ? null : Number(claimResponse.deal.original_price),
        total_stock: Number(claimResponse.deal.total_stock),
        stock_remaining: Number(claimResponse.deal.stock_remaining),
        interested_count: Number(claimResponse.deal.interested_count || 0),
        is_interested: targetDeal.is_interested
      };
      setDeals(prevDeals => prevDeals.map(deal => deal.id === dealId ? updatedDeal : deal));

      const newClaim = {
        id: 'c_' + Date.now(),
        claim_code: claimResponse.claimCode,
        deal_title: targetDeal.title,
        brand: targetDeal.brand,
        price: targetDeal.price,
        original_price: targetDeal.original_price,
        claimed_at: claimResponse.claimedAt,
        status: 'ACTIVE'
      };
      setUserClaims(prev => [newClaim, ...prev]);
    }
  };

  const handleViewDetail = (deal) => {
    setSelectedDeal(deal);
    setActiveTab('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToDeals = () => {
    setSelectedDeal(null);
    setActiveTab('deals');
  };

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    if (user.is_admin) {
      setActiveTab('admin');
    } else {
      setActiveTab('deals');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveTab('deals');
  };

  const interestedDealsCount = deals.filter(d => d.is_interested).length;

  return (
    <div className="app-container">
      <Navbar 
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'detail') setSelectedDeal(null);
        }}
        interestedCount={interestedDealsCount}
        currentUser={currentUser}
        onLoginClick={() => setActiveTab('login')}
        onAdminLoginClick={() => setActiveTab('admin-login')}
        onRegisterClick={() => setActiveTab('register')}
        onLogout={handleLogout}
      />

      <main className="main-content">
        {activeTab === 'deals' && (
          <DealsList 
            deals={deals}
            setDeals={setDeals}
            onViewDetail={handleViewDetail}
            onToggleInterest={handleToggleInterest}
            authToken={currentUser?.token}
          />
        )}

        {activeTab === 'interested' && (
          <InterestedDeals 
            deals={deals}
            onClaim={(d) => { setSelectedDeal(d); setActiveTab('detail'); }}
            onViewDetail={handleViewDetail}
            onToggleInterest={handleToggleInterest}
            onBackToAll={handleBackToDeals}
          />
        )}

        {activeTab === 'my-claims' && (
          <MyClaims 
            userClaims={userClaims}
            onExploreDeals={handleBackToDeals}
          />
        )}

        {activeTab === 'admin' && (
          currentUser?.is_admin ? (
            <AdminDashboard deals={deals} setDeals={setDeals} userClaims={userClaims} authToken={currentUser.token} />
          ) : <AdminLogin onLoginSuccess={handleLoginSuccess} onSwitchToUserLogin={() => setActiveTab('login')} />
        )}

        {activeTab === 'login' && (
          <Login 
            onLoginSuccess={handleLoginSuccess}
            onSwitchToRegister={() => setActiveTab('register')}
          />
        )}

        {activeTab === 'admin-login' && (
          <AdminLogin onLoginSuccess={handleLoginSuccess} onSwitchToUserLogin={() => setActiveTab('login')} />
        )}

        {activeTab === 'register' && (
          <Register 
            onRegisterSuccess={handleLoginSuccess}
            onSwitchToLogin={() => setActiveTab('login')}
          />
        )}

        {activeTab === 'detail' && selectedDeal && (
          <DealDetail 
            deal={deals.find(d => d.id === selectedDeal.id) || selectedDeal} 
            onBack={handleBackToDeals}
            onClaimSuccess={handleClaimSuccess}
            authToken={currentUser?.token}
          />
        )}

        {activeTab === 'how-it-works' && (
          <HowItWorks />
        )}
      </main>

      <Footer />
    </div>
  );
}
