package com.lwd.telemetry.mpt;

public final class MptConstants {

    public static final int FRAME_SYNC_WORD = 0xABCD1234;

    public static final int FRAME_HEADER_SIZE = 20;

    public static final int WAVEFORM_P_WAVE = 0;
    public static final int WAVEFORM_S_WAVE = 1;
    public static final int WAVEFORM_STONELEY = 2;

    public static final int WAVEFORM_CHANNELS = 3;

    public static final int WAVEFORM_SAMPLE_RATE_HZ = 20000;

    public static final int WAVEFORM_SAMPLES_PER_FRAME = 512;

    public static final int WAVEFORM_DATA_SIZE =
            WAVEFORM_CHANNELS * WAVEFORM_SAMPLES_PER_FRAME * 2;

    public static final int FRAME_TOTAL_SIZE = FRAME_HEADER_SIZE + WAVEFORM_DATA_SIZE + 4;

    private MptConstants() {
    }
}
