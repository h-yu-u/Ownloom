"""Both processes run the same request/result contract fixtures."""

import json
import unittest
from pathlib import Path

from mlx_studio_runtime.domain.rpc_validation import validate_rpc


class CodingRpcTests(unittest.TestCase):
    def test_shared_fixtures(self):
        fixtures = json.loads(
            (
                Path(__file__).parents[1] / "packages/coding-protocol/fixtures.json"
            ).read_text()
        )
        for case in fixtures:
            with self.subTest(case=case):
                if case["valid"]:
                    validate_rpc(case["method"], case["kind"], case["value"])
                else:
                    with self.assertRaises(ValueError):
                        validate_rpc(case["method"], case["kind"], case["value"])
