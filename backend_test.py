import requests
import sys
from datetime import datetime
import json

class DiscordRadioBotAPITester:
    def __init__(self, base_url="https://a840322b-89bf-49b8-be15-e5b3ce0af290.preview.emergentagent.com"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def run_test(self, name, method, endpoint, expected_status, data=None, validate_response=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)

            success = response.status_code == expected_status
            response_data = {}
            
            try:
                response_data = response.json()
            except:
                response_data = {"raw_response": response.text}

            if success:
                # Additional validation if provided
                if validate_response and callable(validate_response):
                    validation_result = validate_response(response_data)
                    if validation_result is not True:
                        success = False
                        print(f"❌ Failed validation: {validation_result}")
                    else:
                        print(f"✅ Passed - Status: {response.status_code}, Validation: OK")
                else:
                    print(f"✅ Passed - Status: {response.status_code}")
                
                if success:
                    self.tests_passed += 1
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}...")

            self.test_results.append({
                "test": name,
                "endpoint": endpoint,
                "status": "PASSED" if success else "FAILED",
                "expected_status": expected_status,
                "actual_status": response.status_code,
                "response_sample": str(response_data)[:100] + "..." if len(str(response_data)) > 100 else str(response_data)
            })

            return success, response_data

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.test_results.append({
                "test": name,
                "endpoint": endpoint,
                "status": "ERROR",
                "error": str(e)
            })
            return False, {}

    def test_health_endpoint(self):
        """Test /api/health endpoint"""
        def validate_health(data):
            if not isinstance(data.get('ok'), bool):
                return "Missing or invalid 'ok' field"
            if not data.get('ok'):
                return "'ok' should be True"
            if 'status' not in data:
                return "Missing 'status' field"
            return True

        return self.run_test(
            "Health Check",
            "GET",
            "api/health",
            200,
            validate_response=validate_health
        )

    def test_bots_endpoint(self):
        """Test /api/bots endpoint - Dynamic bots with avatar URLs"""
        def validate_bots(data):
            if 'bots' not in data:
                return "Missing 'bots' field"
            if not isinstance(data['bots'], list):
                return "'bots' should be a list"
            if len(data['bots']) == 0:
                return "No bots found - should have at least placeholder bots"
            
            # Check first bot structure for dynamic bots
            bot = data['bots'][0]
            required_fields = ['bot_id', 'name', 'color', 'avatar_url', 'client_id']
            for field in required_fields:
                if field not in bot:
                    return f"Missing required bot field: {field}"
            
            # Check avatar_url points to /img/bot-N.png
            if not bot['avatar_url'].startswith('/img/bot-'):
                return f"Bot avatar_url should point to /img/bot-N.png, got: {bot['avatar_url']}"
            
            if 'totals' not in data:
                return "Missing 'totals' field"
            
            return True

        return self.run_test(
            "Bots Endpoint (Dynamic with Avatars)",
            "GET",
            "api/bots",
            200,
            validate_response=validate_bots
        )

    def test_stations_endpoint(self):
        """Test /api/stations endpoint - Should return 11 stations with genres"""
        def validate_stations(data):
            if 'stations' not in data:
                return "Missing 'stations' field"
            if not isinstance(data['stations'], list):
                return "'stations' should be a list"
            if len(data['stations']) != 11:
                return f"Expected exactly 11 stations, got {len(data['stations'])}"
            
            # Check station structure
            station = data['stations'][0]
            required_fields = ['key', 'name', 'genre']
            for field in required_fields:
                if field not in station:
                    return f"Missing required station field: {field}"
            
            # Verify genres are properly assigned
            genres_found = set(s['genre'] for s in data['stations'] if s.get('genre'))
            if len(genres_found) < 5:  # Should have diverse genres
                return f"Expected diverse genres, only found: {genres_found}"
            
            if 'total' not in data:
                return "Missing 'total' field"
            
            return True

        return self.run_test(
            "Stations Endpoint (11 stations with genres)",
            "GET",
            "api/stations",
            200,
            validate_response=validate_stations
        )

    def test_stats_endpoint(self):
        """Test /api/stats endpoint - Should include bot and station counts"""
        def validate_stats(data):
            required_fields = ['servers', 'users', 'connections', 'listeners', 'bots', 'stations']
            for field in required_fields:
                if field not in data:
                    return f"Missing required stats field: {field}"
                if not isinstance(data[field], int):
                    return f"Field '{field}' should be an integer"
            
            # Should have at least some bots (placeholder or from .env)
            if data['bots'] < 1:
                return f"Expected at least 1 bot in stats, got {data['bots']}"
            
            # Should have 11 stations
            if data['stations'] != 11:
                return f"Expected 11 stations in stats, got {data['stations']}"
            
            return True

        return self.run_test(
            "Stats Endpoint (Bot and Station counts)",
            "GET",
            "api/stats",
            200,
            validate_response=validate_stats
        )

    def test_commands_endpoint(self):
        """Test /api/commands endpoint - Should return commands with German umlauts"""
        def validate_commands(data):
            if 'commands' not in data:
                return "Missing 'commands' field"
            if not isinstance(data['commands'], list):
                return "'commands' should be a list"
            if len(data['commands']) != 10:
                return f"Expected 10 commands, got {len(data['commands'])}"
            
            # Check command structure
            command = data['commands'][0]
            required_fields = ['name', 'description']
            for field in required_fields:
                if field not in command:
                    return f"Missing required command field: {field}"
            
            # Check if we have expected commands
            command_names = [cmd['name'] for cmd in data['commands']]
            expected_commands = ['/play', '/pause', '/resume', '/stop', '/stations']
            for expected in expected_commands:
                if expected not in command_names:
                    return f"Missing expected command: {expected}"
            
            # Check for German umlauts in descriptions
            all_descriptions = ' '.join(cmd['description'] for cmd in data['commands'])
            german_chars = ['ä', 'ö', 'ü', 'ß']
            umlauts_found = any(char in all_descriptions for char in german_chars)
            if not umlauts_found:
                return "Command descriptions should contain German umlauts (ä, ö, ü)"
            
            return True

        return self.run_test(
            "Commands Endpoint (German umlauts)",
            "GET",
            "api/commands",
            200,
            validate_response=validate_commands
        )

def main():
    # Setup
    print("🚀 Starting Discord Radio Bot API Tests")
    print("=" * 50)
    
    tester = DiscordRadioBotAPITester()

    # Run all tests
    print("\n📋 Running Backend API Tests:")
    
    tester.test_health_endpoint()
    tester.test_bots_endpoint()
    tester.test_stations_endpoint()
    tester.test_stats_endpoint()
    tester.test_commands_endpoint()

    # Print results summary
    print(f"\n📊 Test Results Summary:")
    print("=" * 50)
    print(f"Tests Run: {tester.tests_run}")
    print(f"Tests Passed: {tester.tests_passed}")
    print(f"Tests Failed: {tester.tests_run - tester.tests_passed}")
    print(f"Success Rate: {(tester.tests_passed / tester.tests_run * 100):.1f}%")
    
    # Print detailed results
    print(f"\n📝 Detailed Results:")
    for result in tester.test_results:
        status_emoji = "✅" if result['status'] == "PASSED" else "❌"
        print(f"{status_emoji} {result['test']}: {result['status']}")
        if result['status'] == "FAILED":
            print(f"   Expected: {result.get('expected_status')}, Got: {result.get('actual_status')}")
        elif result['status'] == "ERROR":
            print(f"   Error: {result.get('error')}")

    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    sys.exit(main())