package com.lwd.telemetry.mpt;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class MptFrame {

    private int syncWord;
    private int frameLength;
    private int frameSequence;
    private short frameType;
    private short statusCode;
    private float bitDepth;
    private float temperature;
    private float mudPressure;
    private short channelMask;
    private int sampleCount;
    private float[][] waveformData;

    public float[] getPWave() {
        return waveformData != null && waveformData.length > MptConstants.WAVEFORM_P_WAVE
                ? waveformData[MptConstants.WAVEFORM_P_WAVE] : new float[0];
    }

    public float[] getSWave() {
        return waveformData != null && waveformData.length > MptConstants.WAVEFORM_S_WAVE
                ? waveformData[MptConstants.WAVEFORM_S_WAVE] : new float[0];
    }

    public float[] getStoneleyWave() {
        return waveformData != null && waveformData.length > MptConstants.WAVEFORM_STONELEY
                ? waveformData[MptConstants.WAVEFORM_STONELEY] : new float[0];
    }
}
