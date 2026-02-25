"""
OmniFM Discord Radio Bot - Phase 2 API Tests
Tests for Commander/Worker architecture and MongoDB migration
"""
import pytest
import requests
import os

# Use the production URL from environment
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = 'https://radio-bot-fix-1.preview.emergentagent.com'


class TestHealthEndpoint:
    """Health check tests"""
    
    def test_health_returns_ok(self):
        """GET /api/health returns {ok: true, brand: 'OmniFM'}"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        assert data.get("status") == "online"
        assert data.get("brand") == "OmniFM"
        assert "timestamp" in data
        print(f"✓ Health endpoint OK: brand={data.get('brand')}, status={data.get('status')}")


class TestStationsEndpoint:
    """Station browser API tests"""
    
    def test_stations_returns_data(self):
        """GET /api/stations returns station data with total count"""
        response = requests.get(f"{BASE_URL}/api/stations", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        # Check total count
        assert "total" in data
        assert isinstance(data["total"], int)
        assert data["total"] > 0
        
        # Check stations list
        assert "stations" in data
        assert isinstance(data["stations"], list)
        assert len(data["stations"]) == data["total"]
        
        print(f"✓ Stations endpoint OK: {data['total']} stations returned")
    
    def test_stations_structure(self):
        """Each station has required fields: key, name, url, tier"""
        response = requests.get(f"{BASE_URL}/api/stations", timeout=10)
        data = response.json()
        
        for station in data.get("stations", [])[:5]:  # Check first 5
            assert "key" in station, f"Station missing 'key': {station}"
            assert "name" in station, f"Station missing 'name': {station}"
            assert "url" in station, f"Station missing 'url': {station}"
            assert "tier" in station, f"Station missing 'tier': {station}"
            assert station["tier"] in ["free", "pro", "ultimate"], f"Invalid tier: {station['tier']}"
        
        print("✓ Station structure validation passed")
    
    def test_stations_tier_distribution(self):
        """Verify free and pro station counts"""
        response = requests.get(f"{BASE_URL}/api/stations", timeout=10)
        data = response.json()
        
        stations = data.get("stations", [])
        free_count = sum(1 for s in stations if s.get("tier") == "free")
        pro_count = sum(1 for s in stations if s.get("tier") == "pro")
        
        assert free_count >= 20, f"Expected at least 20 free stations, got {free_count}"
        assert pro_count >= 100, f"Expected at least 100 pro stations, got {pro_count}"
        
        print(f"✓ Station tier distribution: {free_count} free, {pro_count} pro")


class TestStatsEndpoint:
    """Stats API tests"""
    
    def test_stats_returns_data(self):
        """GET /api/stats returns statistics"""
        response = requests.get(f"{BASE_URL}/api/stats", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        # Check required fields
        required_fields = ["servers", "users", "connections", "listeners", "bots", "stations", "freeStations", "proStations"]
        for field in required_fields:
            assert field in data, f"Stats missing '{field}'"
        
        # Verify data types
        assert isinstance(data["bots"], int)
        assert isinstance(data["stations"], int)
        assert data["bots"] >= 2, f"Expected at least 2 bots, got {data['bots']}"
        assert data["stations"] >= 120, f"Expected at least 120 stations, got {data['stations']}"
        
        print(f"✓ Stats endpoint OK: bots={data['bots']}, stations={data['stations']}, freeStations={data['freeStations']}, proStations={data['proStations']}")


class TestCommandsEndpoint:
    """Commands API tests"""
    
    def test_commands_returns_21_commands(self):
        """GET /api/commands returns 21 commands"""
        response = requests.get(f"{BASE_URL}/api/commands", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        assert "commands" in data
        commands = data["commands"]
        assert len(commands) == 21, f"Expected 21 commands, got {len(commands)}"
        
        print(f"✓ Commands endpoint OK: {len(commands)} commands returned")
    
    def test_commands_structure(self):
        """Each command has name, args, description"""
        response = requests.get(f"{BASE_URL}/api/commands", timeout=10)
        data = response.json()
        
        for cmd in data.get("commands", []):
            assert "name" in cmd, f"Command missing 'name': {cmd}"
            assert "description" in cmd, f"Command missing 'description': {cmd}"
            assert cmd["name"].startswith("/"), f"Command name should start with '/': {cmd['name']}"
        
        print("✓ Command structure validation passed")
    
    def test_commands_includes_new_commands(self):
        """Verify new Phase 1 commands: /event, /license, /perm"""
        response = requests.get(f"{BASE_URL}/api/commands", timeout=10)
        data = response.json()
        
        command_names = [cmd["name"] for cmd in data.get("commands", [])]
        
        assert "/event" in command_names, "/event command missing"
        assert "/license" in command_names, "/license command missing"
        assert "/perm" in command_names, "/perm command missing"
        
        print("✓ New commands (/event, /license, /perm) present")


class TestBotsEndpoint:
    """Bots API tests"""
    
    def test_bots_returns_data(self):
        """GET /api/bots returns bot data"""
        response = requests.get(f"{BASE_URL}/api/bots", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        assert "bots" in data
        assert "totals" in data
        assert isinstance(data["bots"], list)
        assert len(data["bots"]) >= 2, f"Expected at least 2 bots, got {len(data['bots'])}"
        
        print(f"✓ Bots endpoint OK: {len(data['bots'])} bots returned")
    
    def test_bots_structure(self):
        """Each bot has required fields"""
        response = requests.get(f"{BASE_URL}/api/bots", timeout=10)
        data = response.json()
        
        required_fields = ["botId", "index", "name", "requiredTier", "color"]
        for bot in data.get("bots", []):
            for field in required_fields:
                assert field in bot, f"Bot missing '{field}': {bot}"
            assert bot["requiredTier"] in ["free", "pro", "ultimate"], f"Invalid requiredTier: {bot['requiredTier']}"
        
        print("✓ Bot structure validation passed")


class TestWorkersEndpoint:
    """NEW: Commander/Worker architecture API tests (Phase 2)"""
    
    def test_workers_returns_architecture_data(self):
        """GET /api/workers returns commander/worker architecture data"""
        response = requests.get(f"{BASE_URL}/api/workers", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        # Check architecture field
        assert data.get("architecture") == "commander_worker", f"Expected architecture='commander_worker', got {data.get('architecture')}"
        
        # Check commander exists
        assert "commander" in data, "Missing 'commander' field"
        assert data["commander"] is not None, "Commander is None"
        
        # Check workers list exists
        assert "workers" in data, "Missing 'workers' field"
        assert isinstance(data["workers"], list), "Workers should be a list"
        
        # Check tiers exists
        assert "tiers" in data, "Missing 'tiers' field"
        
        print(f"✓ Workers endpoint OK: architecture={data.get('architecture')}, workers={len(data.get('workers', []))}")
    
    def test_workers_commander_structure(self):
        """Commander has required fields: index, name, role, requiredTier, online"""
        response = requests.get(f"{BASE_URL}/api/workers", timeout=10)
        data = response.json()
        
        commander = data.get("commander")
        assert commander is not None, "Commander is missing"
        
        required_fields = ["index", "name", "role", "requiredTier", "online", "servers", "activeStreams", "color"]
        for field in required_fields:
            assert field in commander, f"Commander missing '{field}'"
        
        # Commander should have index 1 and role 'commander'
        assert commander["index"] == 1, f"Commander should have index=1, got {commander['index']}"
        assert commander["role"] == "commander", f"Commander should have role='commander', got {commander['role']}"
        
        print(f"✓ Commander structure OK: name={commander.get('name')}, role={commander.get('role')}")
    
    def test_workers_worker_structure(self):
        """Each worker has required fields"""
        response = requests.get(f"{BASE_URL}/api/workers", timeout=10)
        data = response.json()
        
        workers = data.get("workers", [])
        
        for worker in workers:
            required_fields = ["index", "name", "role", "requiredTier", "online", "servers", "activeStreams", "color"]
            for field in required_fields:
                assert field in worker, f"Worker missing '{field}': {worker}"
            
            # Workers should have role 'worker'
            assert worker["role"] == "worker", f"Worker should have role='worker', got {worker['role']}"
        
        print(f"✓ Worker structure OK: {len(workers)} workers validated")
    
    def test_workers_tiers_structure(self):
        """Tiers shows maxWorkers for Free:2, Pro:8, Ultimate:16"""
        response = requests.get(f"{BASE_URL}/api/workers", timeout=10)
        data = response.json()
        
        tiers = data.get("tiers")
        assert tiers is not None, "Tiers is missing"
        
        # Check tier structure
        assert "free" in tiers, "Missing 'free' tier"
        assert "pro" in tiers, "Missing 'pro' tier"
        assert "ultimate" in tiers, "Missing 'ultimate' tier"
        
        # Check maxWorkers values
        assert tiers["free"].get("maxWorkers") == 2, f"Free tier should have maxWorkers=2, got {tiers['free'].get('maxWorkers')}"
        assert tiers["pro"].get("maxWorkers") == 8, f"Pro tier should have maxWorkers=8, got {tiers['pro'].get('maxWorkers')}"
        assert tiers["ultimate"].get("maxWorkers") == 16, f"Ultimate tier should have maxWorkers=16, got {tiers['ultimate'].get('maxWorkers')}"
        
        print("✓ Tier maxWorkers OK: Free=2, Pro=8, Ultimate=16")


class TestPremiumEndpoints:
    """Premium API tests"""
    
    def test_premium_tiers_returns_data(self):
        """GET /api/premium/tiers returns tier configuration"""
        response = requests.get(f"{BASE_URL}/api/premium/tiers", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        assert "tiers" in data
        tiers = data["tiers"]
        
        # Check all tiers exist
        assert "free" in tiers
        assert "pro" in tiers
        assert "ultimate" in tiers
        
        # Check tier structure
        for tier_name in ["free", "pro", "ultimate"]:
            tier = tiers[tier_name]
            assert "name" in tier
            assert "bitrate" in tier
            assert "reconnectMs" in tier
            assert "maxBots" in tier
            assert "pricePerMonth" in tier
        
        print(f"✓ Premium tiers OK: {list(tiers.keys())}")
    
    def test_premium_check_invalid_server_id(self):
        """GET /api/premium/check with invalid serverId returns 400"""
        response = requests.get(f"{BASE_URL}/api/premium/check?serverId=invalid", timeout=10)
        assert response.status_code == 400
        data = response.json()
        assert "error" in data
        
        print("✓ Premium check validates server ID format")
    
    def test_premium_check_unknown_server(self):
        """GET /api/premium/check with unknown server returns free tier"""
        response = requests.get(f"{BASE_URL}/api/premium/check?serverId=123456789012345678", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        assert data.get("tier") == "free", f"Expected tier='free' for unknown server, got {data.get('tier')}"
        
        print("✓ Premium check returns free tier for unknown server")
    
    def test_premium_pricing_returns_data(self):
        """GET /api/premium/pricing returns pricing info"""
        response = requests.get(f"{BASE_URL}/api/premium/pricing", timeout=10)
        assert response.status_code == 200
        data = response.json()
        
        assert "brand" in data
        assert data["brand"] == "OmniFM"
        assert "tiers" in data
        assert "seatOptions" in data
        
        print("✓ Premium pricing endpoint OK")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
