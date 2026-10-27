use super::state::PROTOCOL_VERSION;
use serde_json::Value;

const MAX_FRAME_BYTES: usize = 8192;
#[derive(Debug, PartialEq)]
pub(crate) struct Handshake {
    pub(crate) port: u16,
}
#[derive(Default)]
pub(crate) struct HandshakeDecoder {
    buffer: Vec<u8>,
}
impl HandshakeDecoder {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Result<Vec<Handshake>, &'static str> {
        if self.buffer.len() + bytes.len() > MAX_FRAME_BYTES {
            self.buffer.clear();
            return Err("Runtime handshake exceeds buffer limit");
        }
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();
        while let Some(position) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let frame: Vec<u8> = self.buffer.drain(..=position).collect();
            let value: Value =
                serde_json::from_slice(&frame).map_err(|_| "Invalid Runtime JSON")?;
            if value["type"] != "runtime.ready" {
                continue;
            }
            let port = value["port"]
                .as_u64()
                .and_then(|port| u16::try_from(port).ok())
                .filter(|port| *port > 0)
                .ok_or("Invalid Runtime port")?;
            if value["protocol_version"].as_u64() != Some(u64::from(PROTOCOL_VERSION)) {
                return Err("Runtime protocol is incompatible");
            }
            if value["pid"].as_u64().filter(|pid| *pid > 0).is_none() {
                return Err("Invalid Runtime PID");
            }
            frames.push(Handshake { port });
        }
        Ok(frames)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_handshake_and_port_boundaries() {
        let mut decoder = HandshakeDecoder::default();
        assert!(decoder
            .push(b"{\"type\":\"runtime.ready\",")
            .unwrap()
            .is_empty());
        assert_eq!(
            decoder
                .push(b"\"port\":65535,\"pid\":1,\"protocol_version\":1}\n")
                .unwrap(),
            vec![Handshake { port: 65535 }]
        );
        for port in [0, 65536] {
            let frame = format!(
                "{{\"type\":\"runtime.ready\",\"port\":{port},\"pid\":1,\"protocol_version\":1}}\n"
            );
            assert!(HandshakeDecoder::default().push(frame.as_bytes()).is_err());
        }
    }
    #[test]
    fn limits_unterminated_buffers_and_rejects_malformed_frames() {
        assert!(HandshakeDecoder::default()
            .push(&vec![b'x'; MAX_FRAME_BYTES + 1])
            .is_err());
        assert!(HandshakeDecoder::default().push(b"garbage\n").is_err());
        assert!(HandshakeDecoder::default()
            .push(b"{\"type\":\"runtime.ready\",\"port\":42,\"pid\":1,\"protocol_version\":2}\n")
            .is_err());
    }
}
