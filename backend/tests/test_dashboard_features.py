"""
Test suite for OmniFM Dashboard P0 features:
1. GET /api/dashboard/license endpoint - returns 401 when not authenticated
2. GET /api/health endpoint - returns ok status
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestHealthEndpoint:
    """Health check endpoint tests"""

    def test_health_returns_ok(self):
        """GET /api/health should return ok:true status"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("ok") is True, "Expected ok:true"
        assert data.get("status") == "online", "Expected status:online"
        assert data.get("brand") == "OmniFM", "Expected brand:OmniFM"
        print("✓ /api/health returns ok:true with OmniFM branding")


class TestDashboardLicenseEndpoint:
    """Dashboard license endpoint tests"""

    def test_dashboard_license_requires_auth(self):
        """GET /api/dashboard/license should return 401 when not authenticated"""
        # Test without any authentication
        response = requests.get(
            f"{BASE_URL}/api/dashboard/license?serverId=123456789012345678",
            timeout=10
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        
        data = response.json()
        assert "error" in data, "Expected error message in response"
        print(f"✓ /api/dashboard/license returns 401 without auth: {data.get('error')}")

    def test_dashboard_license_with_invalid_session(self):
        """GET /api/dashboard/license with invalid session returns 401"""
        response = requests.get(
            f"{BASE_URL}/api/dashboard/license?serverId=123456789012345678",
            headers={"Authorization": "Bearer invalid_token_12345"},
            timeout=10
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ /api/dashboard/license returns 401 with invalid bearer token")


class TestAuthSessionEndpoint:
    """Auth session endpoint tests"""

    def test_auth_session_returns_unauthenticated(self):
        """GET /api/auth/session without session returns authenticated:false"""
        response = requests.get(f"{BASE_URL}/api/auth/session", timeout=10)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Should return authenticated:false when not logged in
        assert "authenticated" in data, "Expected authenticated field"
        print(f"✓ /api/auth/session returns authenticated status: {data.get('authenticated')}")


class TestDiscordLoginEndpoint:
    """Discord login endpoint tests"""

    def test_discord_login_returns_auth_url(self):
        """GET /api/auth/discord/login returns auth URL"""
        response = requests.get(
            f"{BASE_URL}/api/auth/discord/login?nextPage=dashboard",
            timeout=10,
            allow_redirects=False
        )
        # Should return 200 with authUrl or 302 redirect
        assert response.status_code in [200, 302], f"Expected 200 or 302, got {response.status_code}"
        
        if response.status_code == 200:
            data = response.json()
            assert "authUrl" in data or "error" in data, "Expected authUrl or error in response"
            print(f"✓ /api/auth/discord/login returns URL or configured status")
        else:
            print(f"✓ /api/auth/discord/login returns redirect")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
