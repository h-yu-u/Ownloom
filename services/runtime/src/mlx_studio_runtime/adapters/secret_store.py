"""macOS Keychain only. No file, environment, or plaintext fallback."""

import sys
import uuid

from keyring.backends.macOS import Keyring
from keyring.errors import KeyringError

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault


class KeychainSecrets:
    def __init__(self, purpose: str = "web-search") -> None:
        # These are durable Keychain namespaces, retained across the Ownloom rebrand.
        self.service = (
            "MLX Studio Web Search" if purpose == "web-search" else "MLX Studio MCP Connections"
        )
        self.error_code = (
            "WEB_CREDENTIAL_UNAVAILABLE" if purpose == "web-search" else "SECRET_STORE_UNAVAILABLE"
        )

    def put(self, value: str) -> str:
        reference = str(uuid.uuid4())
        self.set(reference, value)
        return reference

    def set(self, reference: str, value: str) -> None:
        self._require_macos()
        try:
            Keyring().set_password(self.service, reference, value)
        except KeyringError as error:
            raise self._unavailable() from error

    def find(self, reference: str) -> str | None:
        self._require_macos()
        try:
            value = Keyring().get_password(self.service, reference)
        except KeyringError as error:
            raise self._unavailable() from error
        return value

    def resolve(self, reference: str) -> str:
        value = self.find(reference)
        if not value:
            raise self._unavailable()
        return value

    def delete(self, reference: str) -> None:
        self._require_macos()
        try:
            Keyring().delete_password(self.service, reference)
        except KeyringError as error:
            raise self._unavailable() from error

    def _require_macos(self) -> None:
        if sys.platform != "darwin":
            raise self._unavailable()

    def _unavailable(self) -> RuntimeFault:
        return RuntimeFault(RuntimeErrorInfo(self.error_code, "系统安全存储不可用或凭据已撤销"))
