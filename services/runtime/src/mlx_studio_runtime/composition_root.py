"""Construct concrete adapters once; feature use cases receive narrow dependencies."""

import time
from pathlib import Path

from mlx_studio_runtime.adapters.agent_host import AgentHost
from mlx_studio_runtime.adapters.attachment_derivatives import AttachmentDerivatives
from mlx_studio_runtime.adapters.attachment_files import AttachmentFiles
from mlx_studio_runtime.adapters.attachment_preparation_executor import PreparationExecutor
from mlx_studio_runtime.adapters.audio_files import AudioFiles
from mlx_studio_runtime.adapters.backup_bundle import create_backup_async, release_backup
from mlx_studio_runtime.adapters.coding_model_identity import coding_model_identity
from mlx_studio_runtime.adapters.data_profiles import DataProfiles
from mlx_studio_runtime.adapters.diagnostics import HostDiagnostics
from mlx_studio_runtime.adapters.download_transfer import transfer
from mlx_studio_runtime.adapters.event_hub import EventHub
from mlx_studio_runtime.adapters.image_files import ImageFiles
from mlx_studio_runtime.adapters.managed_models import ManagedModelFiles
from mlx_studio_runtime.adapters.media_recovery import recover_media
from mlx_studio_runtime.adapters.model_download import download_model
from mlx_studio_runtime.adapters.model_scan import manifest_from_directory
from mlx_studio_runtime.adapters.persistence.attachment_preparation_repository import (
    PreparationRepository,
)
from mlx_studio_runtime.adapters.persistence.attachment_reference_repository import (
    AttachmentReferences,
)
from mlx_studio_runtime.adapters.persistence.capability_ledger import CapabilityLedger
from mlx_studio_runtime.adapters.persistence.chat_context_repository import ChatContextRepository
from mlx_studio_runtime.adapters.persistence.download_repository import DownloadRepository
from mlx_studio_runtime.adapters.persistence.sqlite_repositories import SQLiteRepositories
from mlx_studio_runtime.adapters.persistence.submission_journal import SubmissionJournal
from mlx_studio_runtime.adapters.persistence.text_assistant_repository import (
    TextAssistantRepository,
)
from mlx_studio_runtime.adapters.persistence.web_config_repository import WebConfigRepository
from mlx_studio_runtime.adapters.secret_store import KeychainSecrets
from mlx_studio_runtime.adapters.storage_management import StorageManagement
from mlx_studio_runtime.adapters.temporary_data import prune_temporaries
from mlx_studio_runtime.adapters.web.tavily import Tavily
from mlx_studio_runtime.adapters.web.url_policy import PublicResultPolicy
from mlx_studio_runtime.adapters.worker_host import WorkerHost
from mlx_studio_runtime.application.attachments import Attachments
from mlx_studio_runtime.application.builtin_tool_bridge import BuiltinToolBridge
from mlx_studio_runtime.application.capability_grants import CapabilityGrants
from mlx_studio_runtime.application.chat_preparation import ChatPreparation
from mlx_studio_runtime.application.chat_service import ChatService
from mlx_studio_runtime.application.coding_gateway import CodingGateway
from mlx_studio_runtime.application.coding_model_requests import CodingModelRequests
from mlx_studio_runtime.application.coding_run_submission import CodingRunSubmission
from mlx_studio_runtime.application.context_handoff import ContextHandoffs
from mlx_studio_runtime.application.data_management import DataManagement
from mlx_studio_runtime.application.downloads import Downloads
from mlx_studio_runtime.application.extension_gateway import ExtensionGateway
from mlx_studio_runtime.application.image_generation_service import ImageGenerationService
from mlx_studio_runtime.application.inference_service import InferenceService
from mlx_studio_runtime.application.job_lifecycle import JobLifecycle
from mlx_studio_runtime.application.job_scheduler import JobScheduler
from mlx_studio_runtime.application.model_catalog import ModelCatalog
from mlx_studio_runtime.application.model_removal import ModelRemovalPorts, RemoveModel
from mlx_studio_runtime.application.model_runtime import ModelRuntime
from mlx_studio_runtime.application.queries import Queries
from mlx_studio_runtime.application.restore_profile import RestoreProfile, RestoreProfilePorts
from mlx_studio_runtime.application.runtime_control import RuntimeControl
from mlx_studio_runtime.application.runtime_overview import RuntimeOverview, RuntimeSnapshot
from mlx_studio_runtime.application.speech_generation_service import SpeechGenerationService
from mlx_studio_runtime.application.text_assistant import TextAssistant
from mlx_studio_runtime.application.voice_profile_service import VoiceProfileService
from mlx_studio_runtime.application.web_retrieval import WebRetrieval
from mlx_studio_runtime.application.web_settings import WebSettings


class RuntimeApplication:
    def __init__(self, store: SQLiteRepositories, runtime_source: Path) -> None:
        self.store = store
        self.profiles = DataProfiles(store.database_path)
        prune_temporaries(store.database_path.parent / "exports")
        prune_temporaries(store.database_path.parent / "coding" / "exports")
        self.storage = StorageManagement(store.database)
        self.handoffs = ContextHandoffs(
            store.conversations,
            lambda id, owner: self.storage.protect(id, owner, 100 * 365 * 86400),
        )
        self.events = EventHub()
        self.started_at = time.monotonic()
        store.jobs.recover_interrupted("RUNTIME_RESTARTED")
        recover_media(store.database)
        self.catalog = ModelCatalog(
            store.models,
            self.events,
            manifest_from_directory,
            lambda model, path: self.scheduler.check_model_available(model, path),
        )
        self.inference = ModelRuntime(
            self.catalog.models,
            store.models,
            self.events,
            lambda: WorkerHost(
                runtime_source, store.media_path / "images", store.media_path / "audio"
            ),
        )
        self.lifecycle = JobLifecycle(store.jobs, self.events, store.database.transaction)
        self.scheduler = JobScheduler(self.lifecycle, self.inference)
        self.agent_host = AgentHost(store.database_path.parent / "coding")
        self.coding_identity = coding_model_identity
        self.coding = CodingGateway(self.agent_host.request)
        self.extensions = ExtensionGateway(self.coding, KeychainSecrets("mcp-connection"))
        self.coding_requests = CodingModelRequests(
            self.coding, self.catalog.models.get, coding_model_identity
        )
        self.provider_inference = InferenceService(
            self.catalog.models, self.scheduler, self.inference
        )
        self.extensions.cancel_job = self.scheduler.cancel
        self.text_assistant = TextAssistant(
            self.catalog.models,
            self.scheduler,
            self.inference,
            self.extensions,
            TextAssistantRepository(store.database),
            store.jobs,
        )
        self.controls = RuntimeControl(self.scheduler, self.inference)
        contexts = ChatContextRepository(store.database)
        self.queries = Queries(
            store.conversations,
            store.jobs,
            store.images,
            self.lifecycle,
            ImageFiles(store.media_path).read,
            contexts,
            ImageFiles(store.media_path).thumbnail,
        )
        attachment_files = AttachmentFiles(store.attachments, store.media_path)
        preparations = PreparationRepository(store.database)
        preparations.recover()
        self.attachment_references = AttachmentReferences(store.database)
        self.attachments = Attachments(
            attachment_files,
            preparations,
            AttachmentDerivatives(store.media_path),
            PreparationExecutor(runtime_source),
        )
        configs = WebConfigRepository(store.database)
        secrets = KeychainSecrets()
        provider = Tavily()
        retrieval = WebRetrieval(provider, provider, secrets, PublicResultPolicy())
        self.web_settings = WebSettings(configs, secrets, retrieval)
        preparation = ChatPreparation(
            self.attachments,
            contexts,
            configs,
            retrieval,
            self.lifecycle,
            self.extensions,
            self.provider_inference.complete,
        )
        self.downloads = Downloads(
            download_model, self.catalog, DownloadRepository(store.database), transfer
        )
        self.chat = ChatService(
            store.conversations,
            preparation,
            self.catalog.models,
            self.scheduler,
            self.inference,
            SubmissionJournal(store.database),
        )
        self.images = self._image_service(store, attachment_files)
        audio_files = AudioFiles(store.media_path)
        self.voices = VoiceProfileService(store.audio, audio_files)
        self.speech = SpeechGenerationService(
            self.catalog.models,
            self.scheduler,
            self.inference,
            store.audio,
            audio_files,
            self.voices,
        )
        self.capability_grants = CapabilityGrants(
            CapabilityLedger(store.database),
            self.scheduler,
            self.provider_inference,
            BuiltinToolBridge(self.images, self.speech, store.jobs),
            self.extensions,
            self.catalog.models,
            lambda: self.agent_host.epoch,
        )
        self.coding_submissions = CodingRunSubmission(
            self.coding_requests, self.extensions, self.capability_grants
        )
        self.extensions.revoke_scopes = self.capability_grants.revoke
        self.overview = RuntimeOverview(
            self._overview_snapshot,
            HostDiagnostics(
                store.database_path.parent,
                lambda: self.inference.worker.pid if self.inference.worker else None,
            ),
        )
        restore = RestoreProfile(
            RestoreProfilePorts(
                prepare=self.profiles.prepare_async,
                complete=lambda target: (target / "restore-complete").is_file(),
                import_node=lambda identifier: self.coding.call(
                    "data.restore.profile", {"identifier": identifier}
                ),
                activate=self.profiles.activate,
                discard=self.profiles.discard,
                discard_upload=self.profiles.discard_upload,
            )
        )
        self.data = DataManagement(
            self.queries,
            self.coding,
            self.downloads,
            self.scheduler,
            lambda: bool(
                store.database.connection.execute(
                    "SELECT 1 FROM attachment_preparations "
                    "WHERE state IN ('queued','preparing') LIMIT 1"
                ).fetchone()
            ),
            lambda node: create_backup_async(self.storage, node, self.agent_host.directory),
            restore.execute,
            lambda archive: release_backup(self.storage, archive),
        )
        self.model_removal = RemoveModel(
            ModelRemovalPorts(
                self.catalog.models.get,
                self.catalog.remove_registration,
                self.scheduler.reserve_removal,
                self.controls.unload_reserved,
                self.catalog.shared_path,
            ),
            ManagedModelFiles(),
        )

    def _image_service(
        self, store: SQLiteRepositories, attachments: AttachmentFiles
    ) -> ImageGenerationService:
        return ImageGenerationService(
            self.catalog.models,
            self.scheduler,
            self.inference,
            store.images,
            ImageFiles(store.media_path),
            attachments.paths,
        )

    async def close(self) -> None:
        await self.downloads.close()
        await self.agent_host.close()
        await self.capability_grants.close()
        await self.attachments.close()
        await self.scheduler.close()
        self.store.close()

    def _overview_snapshot(self) -> RuntimeSnapshot:
        return RuntimeSnapshot(
            state=self.inference.state.value,
            active_model_id=self.inference.active_model_id,
            worker_restarts=self.inference.worker_restarts,
            active_jobs=sum(
                job.state.value in {"preparing", "running", "cancelling"}
                for job in self.lifecycle.items.values()
            ),
            model_engines=tuple(model.engine for model in self.catalog.models.values()),
            job_states=tuple(str(job["state"]) for job in self.queries.list_jobs()),
            event_sequence=self.events.sequence,
            instance_id=self.events.instance_id,
            worker_epoch=self.inference.epoch,
            worker_phase=self.inference.phase,
            loading_model_id=self.inference.loading_model_id,
        )
