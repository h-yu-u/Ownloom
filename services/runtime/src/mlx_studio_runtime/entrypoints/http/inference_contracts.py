"""The intentionally narrow, text/tool OpenAI provider contract."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FunctionCall(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    arguments: str = Field(max_length=524288)


class ToolCall(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["function"] = "function"
    function: FunctionCall


class TextBlock(BaseModel):
    type: Literal["text"]
    text: str


class InferenceMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[TextBlock] | None = None
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None
    name: str | None = None


class FunctionSchema(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = ""
    parameters: dict[str, object]


class ToolSchema(BaseModel):
    type: Literal["function"] = "function"
    function: FunctionSchema


class InferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str
    messages: list[InferenceMessage] = Field(min_length=1, max_length=300)
    tools: list[ToolSchema] = Field(default_factory=list, max_length=16)
    tool_choice: Literal["auto", "none"] = "auto"
    stream: bool = True
    stream_options: dict[str, bool] | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    output_budget: Literal["fixed", "remaining"] = "fixed"
    context_limit: int | None = Field(default=None, ge=4096, le=1048576)
    temperature: float = Field(default=0.2, ge=0, le=2)
    parallel_tool_calls: Literal[False] = False
    store: Literal[False] = False
