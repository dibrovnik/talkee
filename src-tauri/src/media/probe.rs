use hound::{SampleFormat, WavReader};
use std::io::Cursor;

pub(super) fn local_stt_ready_wav_duration_seconds(input_bytes: &[u8]) -> Option<f64> {
    let Ok(reader) = WavReader::new(Cursor::new(input_bytes)) else {
        return None;
    };
    let spec = reader.spec();

    if spec.sample_rate == 16000
        && spec.channels == 1
        && spec.bits_per_sample == 16
        && spec.sample_format == SampleFormat::Int
    {
        Some(reader.duration() as f64 / spec.sample_rate as f64)
    } else {
        None
    }
}

pub(super) fn is_local_stt_ready_wav(input_bytes: &[u8]) -> bool {
    local_stt_ready_wav_duration_seconds(input_bytes).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_bytes(sample_rate: u32, channels: u16, bits_per_sample: u16) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let spec = hound::WavSpec {
                channels,
                sample_rate,
                bits_per_sample,
                sample_format: SampleFormat::Int,
            };
            let cursor = Cursor::new(&mut bytes);
            let mut writer = hound::WavWriter::new(cursor, spec).expect("wav writer");
            for _ in 0..channels {
                writer.write_sample(0i16).expect("wav sample");
            }
            writer.finalize().expect("wav finalize");
        }
        bytes
    }

    #[test]
    fn detects_local_stt_ready_wav() {
        let wav = wav_bytes(16000, 1, 16);

        assert!(is_local_stt_ready_wav(&wav));
        assert_eq!(
            local_stt_ready_wav_duration_seconds(&wav),
            Some(1.0 / 16000.0)
        );
    }

    #[test]
    fn rejects_wav_that_needs_local_stt_conversion() {
        assert!(!is_local_stt_ready_wav(&wav_bytes(48000, 2, 16)));
        assert!(!is_local_stt_ready_wav(b"not a wav"));
    }
}

/// FFmpeg's segment CSV reports packet boundaries, including a short final chunk.
pub(super) fn segment_durations(csv: &str) -> std::collections::HashMap<String, f64> {
    csv.lines()
        .filter_map(|line| {
            let mut fields = line.rsplitn(3, ',');
            let end = fields.next()?.parse::<f64>().ok()?;
            let start = fields.next()?.parse::<f64>().ok()?;
            let name = fields.next()?.trim_matches('"');
            let name = std::path::Path::new(name).file_name()?.to_str()?;
            let duration = end - start;
            (start.is_finite() && end.is_finite() && start >= 0.0 && duration > 0.0)
                .then(|| (name.to_string(), duration))
        })
        .collect()
}

#[cfg(test)]
mod segment_tests {
    #[test]
    fn measures_short_final_segment_and_rejects_invalid_data() {
        let durations = super::segment_durations("chunk-00000.mp3,0,600\n\"/tmp/a,b/chunk-00001.mp3\",600,612.5\nbad,0,NaN\nnegative,10,1");
        assert_eq!(durations.get("chunk-00000.mp3"), Some(&600.0));
        assert_eq!(durations.get("chunk-00001.mp3"), Some(&12.5));
        assert_eq!(durations.len(), 2);
    }
}
