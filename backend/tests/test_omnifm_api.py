"""
OmniFM v3.0 API Backend Tests
Tests all API endpoints for the Discord Radio Bot
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://bot-delegation.preview.emergentagent.com').rstrip('/')


class TestHealthEndpoint:
    """Health check endpoint tests"""
    
    def test_health_returns_ok(self):
        """GET /api/health returns {ok: true, brand: 'OmniFM'}"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("ok") is True
        assert data.get("brand") == "OmniFM"
        assert "timestamp" in data


class TestStatsEndpoint:
    """Stats endpoint tests"""
    
    def test_stats_returns_correct_counts(self):
        """GET /api/stats returns bots:2, stations:120, freeStations:20, proStations:100"""
        response = requests.get(f"{BASE_URL}/api/stats")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("bots") == 2
        assert data.get("stations") == 120
        assert data.get("freeStations") == 20
        assert data.get("proStations") == 100


class TestStationsEndpoint:
    """Stations endpoint tests"""
    
    def test_stations_returns_120_stations(self):
        """GET /api/stations returns 120 stations"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("total") == 120
        assert len(data.get("stations", [])) == 120
    
    def test_stations_sorted_by_tier(self):
        """GET /api/stations returns stations sorted by tier (free first)"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        
        data = response.json()
        stations = data.get("stations", [])
        
        # First stations should be free tier
        free_stations = [s for s in stations if s.get("tier") == "free"]
        pro_stations = [s for s in stations if s.get("tier") == "pro"]
        
        assert len(free_stations) == 20
        assert len(pro_stations) == 100
        
        # Verify first 20 are free
        for i, station in enumerate(stations[:20]):
            assert station.get("tier") == "free", f"Station at index {i} should be free tier"
    
    def test_stations_have_required_fields(self):
        """Each station has key/name/url/tier"""
        response = requests.get(f"{BASE_URL}/api/stations")
        assert response.status_code == 200
        
        data = response.json()
        stations = data.get("stations", [])
        
        for station in stations[:10]:  # Check first 10
            assert "key" in station
            assert "name" in station
            assert "url" in station
            assert "tier" in station


class TestCommandsEndpoint:
    """Commands endpoint tests"""
    
    def test_commands_returns_21_commands(self):
        """GET /api/commands returns 21 commands"""
        response = requests.get(f"{BASE_URL}/api/commands")
        assert response.status_code == 200
        
        data = response.json()
        commands = data.get("commands", [])
        assert len(commands) == 21
    
    def test_commands_include_required(self):
        """GET /api/commands includes /help, /event, /license, /perm"""
        response = requests.get(f"{BASE_URL}/api/commands")
        assert response.status_code == 200
        
        data = response.json()
        commands = data.get("commands", [])
        command_names = [cmd.get("name") for cmd in commands]
        
        required_commands = ["/help", "/event", "/license", "/perm"]
        for cmd in required_commands:
            assert cmd in command_names, f"Command {cmd} not found"


class TestBotsEndpoint:
    """Bots endpoint tests"""
    
    def test_bots_returns_2_bots(self):
        """GET /api/bots returns 2 bots"""
        response = requests.get(f"{BASE_URL}/api/bots")
        assert response.status_code == 200
        
        data = response.json()
        bots = data.get("bots", [])
        assert len(bots) == 2
    
    def test_bots_have_required_fields(self):
        """Each bot has name, stats, inviteUrl"""
        response = requests.get(f"{BASE_URL}/api/bots")
        assert response.status_code == 200
        
        data = response.json()
        bots = data.get("bots", [])
        
        for bot in bots:
            assert "name" in bot
            assert "inviteUrl" in bot or "requiredTier" in bot
            # Stats fields
            assert "servers" in bot
            assert "users" in bot
            assert "connections" in bot
            assert "listeners" in bot


class TestPremiumCheckEndpoint:
    """Premium check endpoint tests"""
    
    def test_premium_check_invalid_server_id(self):
        """GET /api/premium/check?serverId=test returns error for invalid ID"""
        response = requests.get(f"{BASE_URL}/api/premium/check?serverId=test")
        assert response.status_code == 400
        
        data = response.json()
        assert "error" in data
    
    def test_premium_check_valid_server_id_returns_free(self):
        """GET /api/premium/check?serverId=123456789012345678 returns tier:free for unknown server"""
        response = requests.get(f"{BASE_URL}/api/premium/check?serverId=123456789012345678")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("tier") == "free"
        assert data.get("serverId") == "123456789012345678"


class TestPremiumTiersEndpoint:
    """Premium tiers endpoint tests"""
    
    def test_tiers_returns_all_tiers(self):
        """GET /api/premium/tiers returns free, pro, ultimate tiers"""
        response = requests.get(f"{BASE_URL}/api/premium/tiers")
        assert response.status_code == 200
        
        data = response.json()
        tiers = data.get("tiers", {})
        
        assert "free" in tiers
        assert "pro" in tiers
        assert "ultimate" in tiers
    
    def test_tiers_have_correct_structure(self):
        """Each tier has name, bitrate, reconnectMs, maxBots, pricePerMonth"""
        response = requests.get(f"{BASE_URL}/api/premium/tiers")
        assert response.status_code == 200
        
        data = response.json()
        tiers = data.get("tiers", {})
        
        for tier_name, tier_data in tiers.items():
            assert "name" in tier_data
            assert "bitrate" in tier_data
            assert "reconnectMs" in tier_data
            assert "maxBots" in tier_data
            assert "pricePerMonth" in tier_data


class TestPremiumPricingEndpoint:
    """Premium pricing endpoint tests"""
    
    def test_pricing_returns_all_tiers(self):
        """GET /api/premium/pricing returns pricing data for pro and ultimate plans"""
        response = requests.get(f"{BASE_URL}/api/premium/pricing")
        assert response.status_code == 200
        
        data = response.json()
        
        assert data.get("brand") == "OmniFM"
        assert "tiers" in data
        
        tiers = data.get("tiers", {})
        assert "free" in tiers
        assert "pro" in tiers
        assert "ultimate" in tiers
    
    def test_pricing_has_seat_options(self):
        """GET /api/premium/pricing returns seat pricing options"""
        response = requests.get(f"{BASE_URL}/api/premium/pricing")
        assert response.status_code == 200
        
        data = response.json()
        
        assert "seatOptions" in data
        assert data.get("seatOptions") == [1, 2, 3, 5]
        
        # Pro tier should have seat pricing
        pro_tier = data.get("tiers", {}).get("pro", {})
        assert "seatPricing" in pro_tier
        
        # Ultimate tier should have seat pricing  
        ultimate_tier = data.get("tiers", {}).get("ultimate", {})
        assert "seatPricing" in ultimate_tier


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
