"""THROWAWAY demo (never merged): a deliberately failing test to show the path-scoped Horizon check turns CI red."""
import unittest


class DemoFailure(unittest.TestCase):
    def test_deliberate_failure(self):
        self.fail("deliberate failure to demonstrate that the Horizon CI check blocks")


if __name__ == "__main__":
    unittest.main()
