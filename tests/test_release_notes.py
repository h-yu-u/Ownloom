from __future__ import annotations

from test_release import ReleaseFixture

from scripts.release.release import release_plan


class ReleaseNotesTests(ReleaseFixture):
    def assert_notes_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "release notes"):
            self.assets()
        self.assertFalse((self.root / "public-assets").exists())

    def test_collect_selects_the_requested_tag_without_rewriting_notes(self) -> None:
        self.plan = release_plan("v0.1.1", self.commit)
        expected = "\n# Ownloom v0.1.1\n\n此版本的说明。  \n".encode()
        (self.root / "docs/releases/v0.1.1.md").write_bytes(expected)
        output = self.assets()
        self.assertEqual((output / "RELEASE_NOTES.md").read_bytes(), expected)

    def test_missing_notes_cannot_fall_back_to_another_version(self) -> None:
        (self.root / "docs/releases/v0.1.0.md").unlink()
        (self.root / "docs/releases/v0.1.1.md").write_bytes(self.notes)
        self.assert_notes_rejected()

    def test_empty_notes_fail_before_creating_output(self) -> None:
        (self.root / "docs/releases/v0.1.0.md").write_bytes(b"")
        self.assert_notes_rejected()

    def test_whitespace_only_notes_fail_before_creating_output(self) -> None:
        (self.root / "docs/releases/v0.1.0.md").write_text(" \t\r\n\u3000")
        self.assert_notes_rejected()

    def test_symbolic_notes_fail_before_creating_output(self) -> None:
        notes = self.root / "docs/releases/v0.1.0.md"
        target = self.root / "docs/releases/v0.1.1.md"
        target.write_bytes(self.notes)
        notes.unlink()
        notes.symlink_to(target)
        self.assert_notes_rejected()
