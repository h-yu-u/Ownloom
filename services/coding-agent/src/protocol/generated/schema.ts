// Generated; edit packages/coding-protocol/schema.json.
export const rpcSchema = {
  "protocolVersion": 2,
  "methods": {
    "settings.get": {
      "params": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingSettings"
      }
    },
    "settings.update": {
      "params": {
        "$ref": "#/$defs/CodingSettings"
      },
      "result": {
        "$ref": "#/$defs/CodingSettings"
      }
    },
    "projects.list": {
      "params": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/CodingProjectView"
        }
      }
    },
    "projects.register": {
      "params": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "path"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingProjectView"
      }
    },
    "projects.get": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingProjectView"
      }
    },
    "projects.update": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "commands": {
            "type": "array",
            "maxItems": 8,
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 4096
            }
          }
        },
        "required": [
          "id",
          "commands"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingProjectView"
      }
    },
    "projects.remove": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "removed": {
            "type": "boolean"
          }
        },
        "required": [
          "removed"
        ],
        "additionalProperties": false
      }
    },
    "sessions.list": {
      "params": {
        "type": "object",
        "properties": {
          "projectId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "before": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              {
                "type": "null"
              }
            ]
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 500
          }
        },
        "required": [
          "projectId"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/CodingSessionView"
        }
      }
    },
    "sessions.create": {
      "params": {
        "type": "object",
        "properties": {
          "projectId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          }
        },
        "required": [
          "projectId"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingSessionView"
      }
    },
    "sessions.get": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingSessionView"
      }
    },
    "sessions.update": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "pinned": {
            "type": "boolean"
          },
          "archived": {
            "type": "boolean"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingSessionView"
      }
    },
    "sessions.remove": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "removed": {
            "type": "boolean"
          }
        },
        "required": [
          "removed"
        ],
        "additionalProperties": false
      }
    },
    "sessions.snapshot": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingSnapshot"
      }
    },
    "sessions.files": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingFileList"
      }
    },
    "sessions.read": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "path": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id",
          "path"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "content": {
            "type": "string"
          },
          "sha256": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "content",
          "sha256"
        ],
        "additionalProperties": false
      }
    },
    "sessions.changes": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "diff": {
            "type": "boolean"
          },
          "before": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              {
                "type": "null"
              }
            ]
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 500
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingChanges"
      }
    },
    "changes.get": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingChangeView"
      }
    },
    "changes.restore": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingChangeView"
      }
    },
    "runs.submit": {
      "params": {
        "type": "object",
        "properties": {
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "submissionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 32000
          },
          "mode": {
            "enum": [
              "analyze",
              "develop",
              "review"
            ]
          },
          "provider": {
            "type": "object",
            "properties": {
              "modelId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "baseUrl": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "token": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "contextWindow": {
                "type": "integer",
                "minimum": 1,
                "maximum": 32768
              },
              "fingerprint": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "engineVersion": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              }
            },
            "required": [
              "modelId",
              "baseUrl",
              "token",
              "contextWindow"
            ],
            "additionalProperties": false
          },
          "queue": {
            "type": "boolean"
          },
          "selection": {
            "$ref": "#/$defs/ExtensionSelection"
          },
          "connectionSecrets": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "properties": {
                "revision": {
                  "type": "integer",
                  "minimum": 1
                },
                "digest": {
                  "type": "string"
                },
                "values": {
                  "type": "object",
                  "additionalProperties": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "revision",
                "digest",
                "values"
              ],
              "additionalProperties": false
            }
          },
          "verifyAfter": {
            "type": "boolean"
          },
          "permissionMode": {
            "type": "string",
            "enum": [
              "ask",
              "full"
            ],
            "default": "ask"
          }
        },
        "required": [
          "sessionId",
          "submissionId",
          "text",
          "mode",
          "provider"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingRunView"
      }
    },
    "sessions.verify": {
      "params": {
        "type": "object",
        "properties": {
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "submissionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "provider": {
            "type": "object",
            "properties": {
              "modelId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "baseUrl": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "token": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "contextWindow": {
                "type": "integer",
                "minimum": 1,
                "maximum": 32768
              },
              "fingerprint": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "engineVersion": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              }
            },
            "required": [
              "modelId",
              "baseUrl",
              "token",
              "contextWindow"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "sessionId",
          "submissionId",
          "provider"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingRunView"
      }
    },
    "runs.cancel-active": {
      "params": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "anyOf": [
          {
            "$ref": "#/$defs/CodingRunView"
          },
          {
            "type": "object",
            "properties": {
              "cancelled": {
                "type": "boolean"
              }
            },
            "required": [
              "cancelled"
            ],
            "additionalProperties": false
          }
        ]
      }
    },
    "runs.cancel": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingRunView"
      }
    },
    "runs.steer": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 16000
          }
        },
        "required": [
          "id",
          "text"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "accepted": {
            "type": "boolean"
          }
        },
        "required": [
          "accepted"
        ],
        "additionalProperties": false
      }
    },
    "approvals.resolve": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "allowed": {
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "allowed"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "resolved": {
            "type": "boolean"
          }
        },
        "required": [
          "resolved"
        ],
        "additionalProperties": false
      }
    },
    "events.list": {
      "params": {
        "type": "object",
        "properties": {
          "after": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/CodingEventView"
            }
          },
          "watermark": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "events",
          "watermark"
        ],
        "additionalProperties": false
      }
    },
    "events.wait": {
      "params": {
        "type": "object",
        "properties": {
          "after": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/CodingEventView"
            }
          },
          "watermark": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "events",
          "watermark"
        ],
        "additionalProperties": false
      }
    },
    "capabilities.list": {
      "params": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/CodingCapability"
        }
      }
    },
    "capabilities.verify": {
      "params": {
        "type": "object",
        "properties": {
          "provider": {
            "type": "object",
            "properties": {
              "modelId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "baseUrl": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "token": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "contextWindow": {
                "type": "integer",
                "minimum": 1,
                "maximum": 32768
              },
              "fingerprint": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "engineVersion": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              }
            },
            "required": [
              "modelId",
              "baseUrl",
              "token",
              "contextWindow"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "provider"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingCapability"
      }
    },
    "shutdown": {
      "params": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "closed": {
            "type": "boolean"
          }
        },
        "required": [
          "closed"
        ],
        "additionalProperties": false
      }
    },
    "extensions.catalog.list": {
      "params": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/ExtensionCatalog"
      }
    },
    "extensions.skills.import": {
      "params": {
        "$ref": "#/$defs/SkillImportRequest"
      },
      "result": {
        "$ref": "#/$defs/ExtensionMutation"
      }
    },
    "extensions.skills.publish": {
      "params": {
        "$ref": "#/$defs/SkillImportRequest"
      },
      "result": {
        "$ref": "#/$defs/ExtensionMutation"
      }
    },
    "extensions.skills.inspect": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "revision": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/SkillInspection"
      }
    },
    "extensions.skills.update": {
      "params": {
        "type": "object",
        "properties": {
          "mutationId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 0
          },
          "enabled": {
            "type": "boolean"
          }
        },
        "required": [
          "mutationId",
          "id",
          "expectedRevision",
          "enabled"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/ExtensionMutation"
      }
    },
    "extensions.mcp.save": {
      "params": {
        "$ref": "#/$defs/McpSaveRequest"
      },
      "result": {
        "$ref": "#/$defs/ExtensionMutation"
      }
    },
    "extensions.mcp.inspect": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "revision": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/McpServer"
      }
    },
    "extensions.mcp.test": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "configRevision": {
            "type": "integer",
            "minimum": 0
          },
          "connectionSecrets": {
            "type": "object",
            "additionalProperties": {
              "type": "string",
              "maxLength": 8192
            }
          }
        },
        "required": [
          "id",
          "configRevision"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/ExtensionOperation"
      }
    },
    "extensions.mcp.tools": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "configRevision": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "id",
          "configRevision"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/McpInventory"
      }
    },
    "extensions.operations.get": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/ExtensionOperation"
      }
    },
    "extensions.operations.cancel": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/ExtensionOperation"
      }
    },
    "extensions.mutations.get": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "anyOf": [
          {
            "$ref": "#/$defs/ExtensionMutation"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "extensions.bindings.get": {
      "params": {
        "$ref": "#/$defs/ExtensionScope"
      },
      "result": {
        "$ref": "#/$defs/ExtensionBinding"
      }
    },
    "extensions.bindings.update": {
      "params": {
        "type": "object",
        "properties": {
          "mutationId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "expectedRevision": {
            "type": "integer",
            "minimum": 0
          },
          "scope": {
            "$ref": "#/$defs/ExtensionScope"
          },
          "selection": {
            "$ref": "#/$defs/ExtensionSelection"
          }
        },
        "required": [
          "mutationId",
          "expectedRevision",
          "scope",
          "selection"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/ExtensionMutation"
      }
    },
    "extensions.resolve": {
      "params": {
        "$ref": "#/$defs/ExtensionResolveRequest"
      },
      "result": {
        "$ref": "#/$defs/ExtensionResolution"
      }
    },
    "extensions.revoke": {
      "params": {
        "type": "object",
        "properties": {
          "mutationId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "targetId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          }
        },
        "required": [
          "mutationId",
          "targetId"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/ExtensionMutation"
      }
    },
    "extensions.events.wait": {
      "params": {
        "type": "object",
        "properties": {
          "after": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/ExtensionEvent"
            },
            "maxItems": 200
          },
          "watermark": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "events",
          "watermark"
        ],
        "additionalProperties": false
      }
    },
    "extensions.check": {
      "params": {
        "type": "object",
        "properties": {
          "snapshot": {
            "$ref": "#/$defs/ExtensionSnapshot"
          }
        },
        "required": [
          "snapshot"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "valid": {
            "type": "boolean"
          }
        },
        "required": [
          "valid"
        ],
        "additionalProperties": false
      }
    },
    "runs.prepare": {
      "params": {
        "type": "object",
        "properties": {
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "submissionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 32000
          },
          "mode": {
            "enum": [
              "analyze",
              "develop",
              "review"
            ]
          },
          "provider": {
            "type": "object",
            "properties": {
              "modelId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "baseUrl": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "token": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "contextWindow": {
                "type": "integer",
                "minimum": 1,
                "maximum": 32768
              },
              "fingerprint": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "engineVersion": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              }
            },
            "required": [
              "modelId",
              "baseUrl",
              "token",
              "contextWindow"
            ],
            "additionalProperties": false
          },
          "queue": {
            "type": "boolean"
          },
          "selection": {
            "$ref": "#/$defs/ExtensionSelection"
          },
          "connectionSecrets": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "properties": {
                "revision": {
                  "type": "integer",
                  "minimum": 1
                },
                "digest": {
                  "type": "string"
                },
                "values": {
                  "type": "object",
                  "additionalProperties": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "revision",
                "digest",
                "values"
              ],
              "additionalProperties": false
            }
          },
          "verifyAfter": {
            "type": "boolean"
          },
          "permissionMode": {
            "type": "string",
            "enum": [
              "ask",
              "full"
            ],
            "default": "ask"
          }
        },
        "required": [
          "sessionId",
          "submissionId",
          "text",
          "mode",
          "provider"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingRunView"
      }
    },
    "runs.commit": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "bootstrapToken": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "capabilityUrl": {
            "type": "string",
            "minLength": 1,
            "maxLength": 4096
          },
          "connectionSecrets": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "properties": {
                "revision": {
                  "type": "integer",
                  "minimum": 1
                },
                "digest": {
                  "type": "string"
                },
                "values": {
                  "type": "object",
                  "additionalProperties": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "revision",
                "digest",
                "values"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "id",
          "bootstrapToken",
          "capabilityUrl"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingRunView"
      }
    },
    "agent.sessions.create": {
      "params": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          }
        },
        "required": [
          "title"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/AgentChatSession"
      }
    },
    "agent.sessions.list": {
      "params": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "result": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/AgentChatSession"
        }
      }
    },
    "agent.sessions.snapshot": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/AgentChatSnapshot"
      }
    },
    "agent.runs.prepare": {
      "params": {
        "type": "object",
        "properties": {
          "sessionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "submissionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "text": {
            "type": "string",
            "minLength": 1,
            "maxLength": 32000
          },
          "mode": {
            "enum": [
              "develop"
            ]
          },
          "provider": {
            "type": "object",
            "properties": {
              "modelId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "baseUrl": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "token": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "contextWindow": {
                "type": "integer",
                "minimum": 1,
                "maximum": 32768
              },
              "fingerprint": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              },
              "engineVersion": {
                "type": "string",
                "minLength": 1,
                "maxLength": 8192
              }
            },
            "required": [
              "modelId",
              "baseUrl",
              "token",
              "contextWindow"
            ],
            "additionalProperties": false
          },
          "selection": {
            "$ref": "#/$defs/ExtensionSelection"
          },
          "connectionSecrets": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "properties": {
                "revision": {
                  "type": "integer",
                  "minimum": 1
                },
                "digest": {
                  "type": "string"
                },
                "values": {
                  "type": "object",
                  "additionalProperties": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "revision",
                "digest",
                "values"
              ],
              "additionalProperties": false
            }
          },
          "handoff": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "required": [
          "sessionId",
          "submissionId",
          "text",
          "mode",
          "provider"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingRunView"
      }
    },
    "agent.runs.commit": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "bootstrapToken": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "capabilityUrl": {
            "type": "string",
            "minLength": 1,
            "maxLength": 4096
          },
          "connectionSecrets": {
            "type": "object",
            "additionalProperties": {
              "type": "object",
              "properties": {
                "revision": {
                  "type": "integer",
                  "minimum": 1
                },
                "digest": {
                  "type": "string"
                },
                "values": {
                  "type": "object",
                  "additionalProperties": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "revision",
                "digest",
                "values"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "id",
          "bootstrapToken",
          "capabilityUrl"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingRunView"
      }
    },
    "agent.runs.cancel": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingRunView"
      }
    },
    "agent.approvals.resolve": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "allowed": {
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "allowed"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "resolved": {
            "type": "boolean"
          }
        },
        "required": [
          "resolved"
        ],
        "additionalProperties": false
      }
    },
    "extensions.skills.preview": {
      "params": {
        "$ref": "#/$defs/SkillImportRequest"
      },
      "result": {
        "$ref": "#/$defs/SkillInspection"
      }
    },
    "agent.events.wait": {
      "params": {
        "type": "object",
        "properties": {
          "after": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/CodingEventView"
            }
          },
          "watermark": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "events",
          "watermark"
        ],
        "additionalProperties": false
      }
    },
    "agent.events.list": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "before": {
            "type": "integer",
            "minimum": 1
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "default": 50
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/CodingEventView"
            }
          },
          "watermark": {
            "type": "integer"
          }
        },
        "required": [
          "events",
          "watermark"
        ],
        "additionalProperties": false
      }
    },
    "data.export": {
      "params": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "directory": {
            "type": "string"
          }
        },
        "required": [
          "directory"
        ],
        "additionalProperties": false
      }
    },
    "tasks.list": {
      "params": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "result": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": true
        }
      }
    },
    "agent.tasks.list": {
      "params": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "result": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": true
        }
      }
    },
    "agent.runs.find": {
      "params": {
        "type": "object",
        "properties": {
          "sessionId": {
            "type": "string"
          },
          "submissionId": {
            "type": "string"
          }
        },
        "required": [
          "sessionId",
          "submissionId"
        ],
        "additionalProperties": false
      },
      "result": {
        "anyOf": [
          {
            "type": "null"
          },
          {
            "$ref": "#/$defs/CodingRunView"
          }
        ]
      }
    },
    "data.restore.profile": {
      "params": {
        "type": "object",
        "properties": {
          "identifier": {
            "type": "string",
            "pattern": "^[0-9a-f-]{36}$"
          }
        },
        "required": [
          "identifier"
        ],
        "additionalProperties": false
      },
      "result": {
        "type": "object",
        "properties": {
          "imported": {
            "type": "boolean"
          }
        },
        "required": [
          "imported"
        ],
        "additionalProperties": false
      }
    },
    "runs.permissions": {
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 8192
          },
          "permissionMode": {
            "type": "string",
            "enum": [
              "ask",
              "full"
            ]
          }
        },
        "required": [
          "id",
          "permissionMode"
        ],
        "additionalProperties": false
      },
      "result": {
        "$ref": "#/$defs/CodingRunView"
      }
    }
  },
  "$defs": {
    "CodingSettings": {
      "properties": {
        "id": {
          "type": "string",
          "const": "coding",
          "title": "Id",
          "default": "coding"
        },
        "defaultModelId": {
          "type": "string",
          "maxLength": 128,
          "title": "Defaultmodelid",
          "default": ""
        },
        "contextBudget": {
          "type": "integer",
          "maximum": 1048576,
          "minimum": 4096.0,
          "title": "Contextbudget",
          "default": 32768
        },
        "maxRepairRounds": {
          "type": "integer",
          "maximum": 2.0,
          "minimum": 0.0,
          "title": "Maxrepairrounds",
          "default": 2
        }
      },
      "additionalProperties": false,
      "type": "object",
      "title": "CodingSettings"
    },
    "CodingProjectView": {
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "path": {
          "type": "string",
          "title": "Path"
        },
        "name": {
          "type": "string",
          "title": "Name"
        },
        "git": {
          "type": "boolean",
          "title": "Git"
        },
        "branch": {
          "type": "string",
          "title": "Branch"
        },
        "dirty": {
          "type": "string",
          "title": "Dirty"
        },
        "instructions": {
          "type": "string",
          "title": "Instructions"
        },
        "commands": {
          "items": {
            "type": "string"
          },
          "type": "array",
          "title": "Commands"
        }
      },
      "type": "object",
      "required": [
        "id",
        "path",
        "name",
        "git",
        "branch",
        "dirty",
        "instructions",
        "commands"
      ],
      "title": "CodingProjectView"
    },
    "CodingSessionView": {
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "projectId": {
          "type": "string",
          "title": "Projectid"
        },
        "title": {
          "type": "string",
          "title": "Title"
        },
        "pinned": {
          "type": "boolean",
          "title": "Pinned"
        },
        "archived": {
          "type": "boolean",
          "title": "Archived"
        },
        "piPath": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "title": "Pipath"
        }
      },
      "type": "object",
      "required": [
        "id",
        "projectId",
        "title",
        "pinned",
        "archived",
        "piPath"
      ],
      "title": "CodingSessionView"
    },
    "CodingRunView": {
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "sessionId": {
          "type": "string",
          "title": "Sessionid"
        },
        "submissionId": {
          "type": "string",
          "title": "Submissionid"
        },
        "text": {
          "type": "string",
          "title": "Text"
        },
        "modelId": {
          "type": "string",
          "title": "Modelid"
        },
        "mode": {
          "type": "string",
          "enum": [
            "analyze",
            "develop",
            "review"
          ],
          "title": "Mode"
        },
        "status": {
          "type": "string",
          "enum": [
            "queued",
            "starting",
            "running",
            "awaiting_approval",
            "cancelling",
            "completed",
            "failed",
            "cancelled",
            "interrupted"
          ],
          "title": "Status"
        },
        "phase": {
          "type": "string",
          "title": "Phase"
        },
        "verification": {
          "type": "string",
          "enum": [
            "not_run",
            "running",
            "passed",
            "failed",
            "partial"
          ],
          "title": "Verification"
        },
        "error": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "title": "Error"
        },
        "createdAt": {
          "type": "string",
          "title": "Createdat"
        },
        "baseline": {
          "type": "string",
          "title": "Baseline"
        },
        "fingerprint": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "title": "Fingerprint"
        },
        "maxRepairRounds": {
          "type": "integer",
          "title": "Maxrepairrounds"
        },
        "capabilitySnapshot": {
          "$ref": "#/$defs/ExtensionSnapshot"
        },
        "selection": {
          "$ref": "#/$defs/ExtensionSelection"
        },
        "verificationPlan": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "object",
              "properties": {
                "digest": {
                  "type": "string"
                },
                "commands": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                },
                "cwd": {
                  "type": "string"
                },
                "manifestDigest": {
                  "type": "string"
                },
                "repairLimit": {
                  "type": "integer"
                },
                "timeoutMs": {
                  "type": "integer"
                },
                "scope": {
                  "type": "string"
                },
                "invalid": {
                  "type": "boolean"
                }
              },
              "required": [
                "digest",
                "commands",
                "cwd",
                "manifestDigest",
                "repairLimit",
                "timeoutMs",
                "scope"
              ]
            }
          ]
        },
        "permissionMode": {
          "type": "string",
          "enum": [
            "ask",
            "full"
          ]
        }
      },
      "type": "object",
      "required": [
        "id",
        "sessionId",
        "submissionId",
        "text",
        "modelId",
        "mode",
        "status",
        "phase",
        "verification",
        "error",
        "createdAt",
        "baseline",
        "fingerprint",
        "maxRepairRounds"
      ],
      "title": "CodingRunView"
    },
    "CodingApprovalView": {
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "runId": {
          "type": "string",
          "title": "Runid"
        },
        "sessionId": {
          "type": "string",
          "title": "Sessionid"
        },
        "toolCallId": {
          "type": "string",
          "title": "Toolcallid"
        },
        "action": {
          "enum": [
            "command",
            "file_write",
            "mcp"
          ]
        },
        "parameters": {
          "additionalProperties": true,
          "type": "object",
          "title": "Parameters"
        },
        "command": {
          "type": "string",
          "title": "Command"
        },
        "cwd": {
          "type": "string",
          "title": "Cwd"
        },
        "policyVersion": {
          "type": "integer",
          "const": 1,
          "title": "Policyversion"
        },
        "expiresAt": {
          "type": "integer",
          "title": "Expiresat"
        },
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "allowed",
            "denied"
          ],
          "title": "Status"
        }
      },
      "type": "object",
      "required": [
        "id",
        "runId",
        "sessionId",
        "toolCallId",
        "action",
        "parameters",
        "command",
        "cwd",
        "policyVersion",
        "expiresAt",
        "status"
      ],
      "title": "CodingApprovalView"
    },
    "CodingVerificationView": {
      "properties": {
        "purpose": {
          "type": "string",
          "enum": [
            "command",
            "verification"
          ],
          "title": "Purpose",
          "default": "command"
        },
        "id": {
          "type": "string",
          "title": "Id"
        },
        "runId": {
          "type": "string",
          "title": "Runid"
        },
        "sessionId": {
          "type": "string",
          "title": "Sessionid"
        },
        "command": {
          "type": "string",
          "title": "Command"
        },
        "exitCode": {
          "anyOf": [
            {
              "type": "integer"
            },
            {
              "type": "null"
            }
          ],
          "title": "Exitcode"
        },
        "output": {
          "type": "string",
          "title": "Output"
        },
        "truncated": {
          "type": "boolean",
          "title": "Truncated"
        },
        "fingerprint": {
          "type": "string",
          "title": "Fingerprint"
        },
        "stale": {
          "type": "boolean",
          "title": "Stale"
        },
        "planDigest": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "type": "object",
      "required": [
        "id",
        "runId",
        "sessionId",
        "command",
        "exitCode",
        "output",
        "truncated",
        "fingerprint",
        "stale"
      ],
      "title": "CodingVerificationView"
    },
    "CodingChangeView": {
      "properties": {
        "contentLoaded": {
          "type": "boolean",
          "title": "Contentloaded",
          "default": true
        },
        "id": {
          "type": "string",
          "title": "Id"
        },
        "runId": {
          "type": "string",
          "title": "Runid"
        },
        "sessionId": {
          "type": "string",
          "title": "Sessionid"
        },
        "path": {
          "type": "string",
          "title": "Path"
        },
        "before": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "title": "Before"
        },
        "after": {
          "type": "string",
          "title": "After"
        },
        "restored": {
          "type": "boolean",
          "title": "Restored"
        },
        "state": {
          "type": "string",
          "enum": [
            "pending",
            "written"
          ],
          "title": "State"
        }
      },
      "type": "object",
      "required": [
        "id",
        "runId",
        "sessionId",
        "path",
        "before",
        "after",
        "restored",
        "state"
      ],
      "title": "CodingChangeView"
    },
    "CodingChanges": {
      "properties": {
        "managed": {
          "items": {
            "$ref": "#/$defs/CodingChangeView"
          },
          "type": "array",
          "title": "Managed"
        },
        "workspace": {
          "type": "string",
          "title": "Workspace"
        },
        "diff": {
          "type": "string",
          "title": "Diff"
        },
        "scope": {
          "type": "string",
          "title": "Scope"
        }
      },
      "type": "object",
      "required": [
        "managed",
        "workspace",
        "diff",
        "scope"
      ],
      "title": "CodingChanges"
    },
    "CodingFileList": {
      "properties": {
        "files": {
          "items": {
            "type": "string"
          },
          "type": "array",
          "title": "Files"
        }
      },
      "type": "object",
      "required": [
        "files"
      ],
      "title": "CodingFileList"
    },
    "CodingFileView": {
      "properties": {
        "content": {
          "type": "string",
          "title": "Content"
        },
        "sha256": {
          "type": "string",
          "title": "Sha256"
        }
      },
      "type": "object",
      "required": [
        "content",
        "sha256"
      ],
      "title": "CodingFileView"
    },
    "CodingCapability": {
      "properties": {
        "id": {
          "type": "string",
          "title": "Id"
        },
        "status": {
          "type": "string",
          "enum": [
            "verified",
            "unverified"
          ],
          "title": "Status"
        },
        "verifiedAt": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "title": "Verifiedat"
        },
        "engineVersion": {
          "type": "string",
          "title": "Engineversion"
        },
        "parserVersion": {
          "type": "string",
          "title": "Parserversion"
        },
        "modelFingerprint": {
          "type": "string",
          "title": "Modelfingerprint"
        },
        "detail": {
          "type": "string",
          "title": "Detail"
        }
      },
      "type": "object",
      "required": [
        "id",
        "status",
        "verifiedAt",
        "engineVersion",
        "parserVersion",
        "modelFingerprint",
        "detail"
      ],
      "title": "CodingCapability"
    },
    "CodingSnapshot": {
      "properties": {
        "session": {
          "$ref": "#/$defs/CodingSessionView"
        },
        "project": {
          "$ref": "#/$defs/CodingProjectView"
        },
        "runs": {
          "items": {
            "$ref": "#/$defs/CodingRunView"
          },
          "type": "array",
          "title": "Runs"
        },
        "approvals": {
          "items": {
            "$ref": "#/$defs/CodingApprovalView"
          },
          "type": "array",
          "title": "Approvals"
        },
        "verifications": {
          "items": {
            "$ref": "#/$defs/CodingVerificationView"
          },
          "type": "array",
          "title": "Verifications"
        },
        "events": {
          "items": {
            "$ref": "#/$defs/CodingEventView"
          },
          "type": "array",
          "title": "Events"
        },
        "watermark": {
          "type": "integer",
          "title": "Watermark"
        },
        "activeRun": {
          "anyOf": [
            {
              "$ref": "#/$defs/CodingRunView"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "type": "object",
      "required": [
        "session",
        "project",
        "runs",
        "approvals",
        "verifications",
        "events",
        "watermark",
        "activeRun"
      ],
      "title": "CodingSnapshot"
    },
    "CodingEventView": {
      "properties": {
        "seq": {
          "type": "integer",
          "title": "Seq"
        },
        "sessionId": {
          "type": "string",
          "title": "Sessionid"
        },
        "runId": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ],
          "title": "Runid"
        },
        "type": {
          "type": "string",
          "title": "Type"
        },
        "text": {
          "type": "string",
          "title": "Text"
        },
        "data": {
          "title": "Data"
        }
      },
      "type": "object",
      "required": [
        "seq",
        "sessionId",
        "runId",
        "type",
        "text",
        "data"
      ],
      "title": "CodingEventView"
    },
    "ExtensionSelection": {
      "type": "object",
      "properties": {
        "skillIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "maxItems": 16
        },
        "toolIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "maxItems": 16
        },
        "mediaBindings": {
          "$ref": "#/$defs/ExtensionMediaBindings"
        }
      },
      "required": [
        "skillIds",
        "toolIds"
      ],
      "additionalProperties": false
    },
    "ExtensionScope": {
      "type": "object",
      "properties": {
        "workspace": {
          "enum": [
            "chat",
            "coding",
            "image",
            "audio"
          ]
        },
        "kind": {
          "enum": [
            "workspace",
            "project",
            "session"
          ]
        },
        "scopeId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        }
      },
      "required": [
        "workspace",
        "kind",
        "scopeId"
      ],
      "additionalProperties": false
    },
    "ExtensionRef": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "revision": {
          "type": "integer",
          "minimum": 1
        },
        "digest": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      },
      "required": [
        "id",
        "revision",
        "digest"
      ],
      "additionalProperties": false
    },
    "SkillFile": {
      "type": "object",
      "properties": {
        "relativePath": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "digest": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "size": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "relativePath",
        "digest",
        "size"
      ],
      "additionalProperties": false
    },
    "ExtensionSkill": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "revision": {
          "type": "integer",
          "minimum": 1
        },
        "digest": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024
        },
        "source": {
          "enum": [
            "builtin",
            "local-import"
          ]
        },
        "sourceRef": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "enabled": {
          "type": "boolean"
        },
        "workspaces": {
          "type": "array",
          "items": {
            "enum": [
              "chat",
              "coding",
              "image",
              "audio"
            ]
          },
          "maxItems": 4
        },
        "requiredCapabilities": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "maxItems": 16
        },
        "files": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/SkillFile"
          },
          "maxItems": 200
        },
        "contentRevision": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "id",
        "revision",
        "digest",
        "name",
        "description",
        "source",
        "sourceRef",
        "enabled",
        "workspaces",
        "requiredCapabilities",
        "files"
      ],
      "additionalProperties": false
    },
    "SkillInspection": {
      "type": "object",
      "properties": {
        "skill": {
          "$ref": "#/$defs/ExtensionSkill"
        },
        "body": {
          "type": "string",
          "maxLength": 65536
        },
        "diagnostics": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 1024
          },
          "maxItems": 200
        }
      },
      "required": [
        "skill",
        "body",
        "diagnostics"
      ],
      "additionalProperties": false
    },
    "McpStdioTransport": {
      "type": "object",
      "properties": {
        "type": {
          "enum": [
            "stdio"
          ]
        },
        "executable": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "args": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 4096
          },
          "maxItems": 64
        },
        "cwd": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "publicEnv": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 8192
          }
        },
        "secretRefs": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 8192
          }
        }
      },
      "required": [
        "type",
        "executable",
        "args",
        "cwd",
        "publicEnv",
        "secretRefs"
      ],
      "additionalProperties": false
    },
    "McpHttpTransport": {
      "type": "object",
      "properties": {
        "type": {
          "enum": [
            "streamable-http"
          ]
        },
        "url": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "publicHeaders": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 8192
          }
        },
        "secretRefs": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 8192
          }
        },
        "authMode": {
          "enum": [
            "none",
            "bearer",
            "api-key"
          ]
        }
      },
      "required": [
        "type",
        "url",
        "publicHeaders",
        "secretRefs",
        "authMode"
      ],
      "additionalProperties": false
    },
    "McpTransport": {
      "anyOf": [
        {
          "$ref": "#/$defs/McpStdioTransport"
        },
        {
          "$ref": "#/$defs/McpHttpTransport"
        }
      ]
    },
    "McpServer": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "revision": {
          "type": "integer",
          "minimum": 1
        },
        "digest": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "enabled": {
          "type": "boolean"
        },
        "transport": {
          "$ref": "#/$defs/McpTransport"
        },
        "allowedTools": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "maxItems": 64
        },
        "readOnlyTools": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "maxItems": 64
        },
        "credentialConfigured": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "revision",
        "digest",
        "name",
        "enabled",
        "transport",
        "allowedTools",
        "readOnlyTools",
        "credentialConfigured"
      ],
      "additionalProperties": false
    },
    "ExtensionTool": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "serverId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "originalName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "modelName": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "schemaDigest": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "description": {
          "type": "string",
          "maxLength": 4096
        },
        "inputSchema": {
          "type": "object",
          "additionalProperties": true
        },
        "risk": {
          "enum": [
            "read",
            "ask"
          ]
        }
      },
      "required": [
        "id",
        "serverId",
        "originalName",
        "modelName",
        "schemaDigest",
        "description",
        "inputSchema",
        "risk"
      ],
      "additionalProperties": false
    },
    "McpInventory": {
      "type": "object",
      "properties": {
        "serverId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "configRevision": {
          "type": "integer",
          "minimum": 0
        },
        "inventoryRevision": {
          "type": "integer",
          "minimum": 0
        },
        "digest": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "tools": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ExtensionTool"
          },
          "maxItems": 128
        },
        "resources": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "uri": {
                "type": "string",
                "minLength": 1,
                "maxLength": 4096
              },
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1024
              }
            },
            "required": [
              "uri",
              "name"
            ],
            "additionalProperties": false
          },
          "maxItems": 200
        }
      },
      "required": [
        "serverId",
        "configRevision",
        "inventoryRevision",
        "digest",
        "tools",
        "resources"
      ],
      "additionalProperties": false
    },
    "ExtensionBinding": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "revision": {
          "type": "integer",
          "minimum": 0
        },
        "scope": {
          "$ref": "#/$defs/ExtensionScope"
        },
        "selection": {
          "$ref": "#/$defs/ExtensionSelection"
        }
      },
      "required": [
        "id",
        "revision",
        "scope",
        "selection"
      ],
      "additionalProperties": false
    },
    "ExtensionSnapshot": {
      "type": "object",
      "properties": {
        "schemaVersion": {
          "enum": [
            1
          ]
        },
        "workspace": {
          "enum": [
            "chat",
            "coding",
            "image",
            "audio"
          ]
        },
        "catalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "policyEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "skills": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ExtensionSkill"
          },
          "maxItems": 16
        },
        "servers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/McpServer"
          },
          "maxItems": 16
        },
        "tools": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ExtensionTool"
          },
          "maxItems": 16
        },
        "snapshotDigest": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "mediaBindings": {
          "$ref": "#/$defs/ExtensionMediaBindings"
        },
        "mode": {
          "enum": [
            "analyze",
            "develop",
            "review"
          ]
        }
      },
      "required": [
        "schemaVersion",
        "workspace",
        "catalogRevision",
        "policyEpoch",
        "skills",
        "servers",
        "tools",
        "snapshotDigest"
      ],
      "additionalProperties": false
    },
    "ExtensionResolution": {
      "type": "object",
      "properties": {
        "snapshot": {
          "$ref": "#/$defs/ExtensionSnapshot"
        },
        "totalToolCount": {
          "type": "integer",
          "minimum": 0
        },
        "estimatedContextTokens": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "snapshot",
        "totalToolCount",
        "estimatedContextTokens"
      ],
      "additionalProperties": false
    },
    "ExtensionOperation": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "serverId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "state": {
          "enum": [
            "running",
            "cancelled",
            "failed",
            "succeeded",
            "interrupted"
          ]
        },
        "errorCode": {
          "anyOf": [
            {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            {
              "type": "null"
            }
          ]
        },
        "inventory": {
          "anyOf": [
            {
              "$ref": "#/$defs/McpInventory"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "id",
        "serverId",
        "state",
        "errorCode",
        "inventory"
      ],
      "additionalProperties": false
    },
    "ExtensionEvent": {
      "type": "object",
      "properties": {
        "seq": {
          "type": "integer",
          "minimum": 0
        },
        "type": {
          "enum": [
            "extension.config_updated",
            "skill.version_published",
            "mcp.inventory_changed",
            "capability.revoked"
          ]
        },
        "targetId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "catalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "policyEpoch": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "seq",
        "type",
        "targetId",
        "catalogRevision",
        "policyEpoch"
      ],
      "additionalProperties": false
    },
    "ExtensionCatalog": {
      "type": "object",
      "properties": {
        "catalogRevision": {
          "type": "integer",
          "minimum": 0
        },
        "policyEpoch": {
          "type": "integer",
          "minimum": 0
        },
        "skills": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ExtensionSkill"
          },
          "maxItems": 200
        },
        "servers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/McpServer"
          },
          "maxItems": 200
        },
        "inventories": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/McpInventory"
          },
          "maxItems": 200
        },
        "builtinTools": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/ExtensionTool"
          }
        }
      },
      "required": [
        "catalogRevision",
        "policyEpoch",
        "skills",
        "servers",
        "inventories",
        "builtinTools"
      ],
      "additionalProperties": false
    },
    "ExtensionMutation": {
      "type": "object",
      "properties": {
        "mutationId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "targetId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 512
        },
        "revision": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "mutationId",
        "targetId",
        "revision"
      ],
      "additionalProperties": false
    },
    "SkillImportRequest": {
      "type": "object",
      "properties": {
        "mutationId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "workspaces": {
          "type": "array",
          "items": {
            "enum": [
              "chat",
              "coding",
              "image",
              "audio"
            ]
          },
          "maxItems": 4
        },
        "requiredCapabilities": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "maxItems": 16
        },
        "expectedDigest": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      },
      "required": [
        "mutationId",
        "path",
        "workspaces",
        "requiredCapabilities"
      ],
      "additionalProperties": false
    },
    "McpSaveRequest": {
      "type": "object",
      "properties": {
        "mutationId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 0
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
        },
        "enabled": {
          "type": "boolean"
        },
        "transport": {
          "$ref": "#/$defs/McpTransport"
        },
        "allowedTools": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "maxItems": 64
        },
        "readOnlyTools": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "maxItems": 64
        },
        "credentialIntent": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        }
      },
      "required": [
        "mutationId",
        "expectedRevision",
        "name",
        "enabled",
        "transport",
        "allowedTools",
        "readOnlyTools"
      ],
      "additionalProperties": false
    },
    "ExtensionResolveRequest": {
      "type": "object",
      "properties": {
        "scope": {
          "$ref": "#/$defs/ExtensionScope"
        },
        "selection": {
          "$ref": "#/$defs/ExtensionSelection"
        },
        "mode": {
          "enum": [
            "analyze",
            "develop",
            "review"
          ]
        },
        "contextBudget": {
          "type": "integer",
          "minimum": 4096,
          "maximum": 32768
        },
        "channel": {
          "enum": [
            "text",
            "agent"
          ]
        }
      },
      "required": [
        "scope"
      ],
      "additionalProperties": false
    },
    "ExtensionMediaBindings": {
      "type": "object",
      "properties": {
        "imageModelId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "speechModelId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "speechMode": {
          "enum": [
            "preset",
            "clone"
          ]
        },
        "speaker": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "voiceId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "imageMode": {
          "enum": [
            "generate",
            "edit",
            "inpaint"
          ]
        },
        "imageReferenceIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "maxItems": 10
        },
        "imageMaskId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        }
      },
      "additionalProperties": false
    },
    "AgentChatSession": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "piPath": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "required": [
        "id",
        "title",
        "piPath"
      ],
      "additionalProperties": false
    },
    "AgentChatSnapshot": {
      "type": "object",
      "properties": {
        "session": {
          "$ref": "#/$defs/AgentChatSession"
        },
        "runs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/CodingRunView"
          }
        },
        "approvals": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/CodingApprovalView"
          }
        },
        "events": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/CodingEventView"
          }
        },
        "watermark": {
          "type": "integer",
          "default": 0
        }
      },
      "required": [
        "session",
        "runs",
        "approvals",
        "events"
      ],
      "additionalProperties": false
    }
  },
  "errors": [
    "APPROVAL_ALREADY_RESOLVED",
    "APPROVAL_DENIED",
    "APPROVAL_NOT_FOUND",
    "BINARY_FILE_REJECTED",
    "CANCELLED",
    "CAPABILITY_NOT_FOUND",
    "CHANGE_NOT_FOUND",
    "CODING_BUSY",
    "CODING_DATABASE_TOO_NEW",
    "CODING_DATA_DIRECTORY_REQUIRED",
    "CODING_FAILED",
    "CODING_QUEUE_FULL",
    "COMMIT",
    "DUPLICATE_TOOL_ID",
    "EDIT_NOT_UNIQUE",
    "ENOENT",
    "ESRCH",
    "FILE_TOO_LARGE_OR_NOT_TEXT",
    "FILE_VERSION_CONFLICT",
    "FRAME_TOO_LARGE",
    "GIT_MUTATION_DISABLED",
    "HEAD",
    "HOST_FAILED",
    "HOST_RESTARTED",
    "HOST_SHUTTING_DOWN",
    "IDEMPOTENCY_CONFLICT",
    "INVALID_APPROVAL",
    "INVALID_COMMANDS",
    "INVALID_LIMIT",
    "INVALID_MODE",
    "INVALID_PARAMS",
    "INVALID_PARENT",
    "INVALID_SETTINGS",
    "LOCAL_PROVIDER_REQUIRED",
    "MODEL_CONNECTION_FAILED",
    "MODEL_INFERENCE_FAILED",
    "MODEL_NOT_FOUND",
    "MODEL_OUTPUT_TRUNCATED",
    "MODEL_REQUEST_TIMEOUT",
    "MODEL_TOOLS_UNVERIFIED",
    "PATH_EXCLUDED",
    "PATH_OUTSIDE_WORKSPACE",
    "PROBE_COMMAND_NOT_ALLOWED",
    "PROJECT_DIRECTORY_REQUIRED",
    "PROJECT_HAS_SESSIONS",
    "PROJECT_NOT_FOUND",
    "PROTOCOL_MISMATCH",
    "READ_ONLY_MODE",
    "RESTORE_CONFLICT",
    "ROLLBACK",
    "RPC_RESULT_INVALID",
    "RUN_ALREADY_FINISHED",
    "RUN_CANCELLING",
    "RUN_NOT_FOUND",
    "RUN_NOT_READY",
    "SESSION_ARCHIVED",
    "SESSION_IN_USE",
    "SESSION_NOT_FOUND",
    "SETTINGS_NOT_FOUND",
    "SIGINT",
    "SIGKILL",
    "SIGTERM",
    "SYMLINK_REJECTED",
    "TOOL_BUDGET_EXCEEDED",
    "UNKNOWN_METHOD",
    "VERIFICATION_COMMANDS_REQUIRED",
    "VERIFICATION_NOT_FOUND",
    "WORKSPACE_FINGERPRINT_LIMIT",
    "WORKSPACE_ROOT_CHANGED"
  ],
  "errorPattern": "^[A-Z][A-Z0-9_]{1,79}$"
} as const
