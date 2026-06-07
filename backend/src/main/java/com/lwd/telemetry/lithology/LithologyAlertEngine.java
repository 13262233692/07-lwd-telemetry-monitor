package com.lwd.telemetry.lithology;

import com.lwd.telemetry.mpt.MptConstants;
import com.lwd.telemetry.mpt.MptFrame;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedList;

@Slf4j
@Component
public class LithologyAlertEngine {

    private static final double MATRIX_TRANSIT_TIME_US_FT = 55.5;
    private static final double FLUID_TRANSIT_TIME_US_FT = 189.0;
    private static final double GAS_TRANSIT_TIME_US_FT = 900.0;

    private static final double P_WAVE_VELOCITY_FT_S = 20000.0;
    private static final double SAMPLE_INTERVAL_US = 1.0e6 / MptConstants.WAVEFORM_SAMPLE_RATE_HZ;

    private static final int SLIDING_WINDOW_SIZE = 5;
    private static final double POROSITY_MUTATION_THRESHOLD = 0.08;
    private static final double GAMMA_RAY_GAS_THRESHOLD = 30.0;
    private static final double GAMMA_RAY_SHALE_THRESHOLD = 75.0;
    private static final double POROSITY_GAS_MIN = 0.15;
    private static final double POROSITY_WATER_MIN = 0.20;
    private static final double ATTENUATION_WATER_MAX = 0.35;

    private final LinkedList<Double> transitTimeWindow = new LinkedList<>();
    private final LinkedList<Double> attenuationWindow = new LinkedList<>();
    private final LinkedList<Double> gammaRayWindow = new LinkedList<>();

    private double previousPorosity = Double.NaN;

    public LithologyAlert evaluate(MptFrame frame) {
        float[] pWave = frame.getPWave();
        if (pWave == null || pWave.length < 10) {
            return buildNormalAlert(frame, 0, 0, 0, 0);
        }

        double transitTime = extractTransitTime(pWave);
        double attenuation = extractAttenuation(pWave);
        double gammaRay = frame.getGammaRay();

        double transitTimeFiltered = slidingWindowFilter(transitTimeWindow, transitTime);
        double attenuationFiltered = slidingWindowFilter(attenuationWindow, attenuation);
        double gammaRayFiltered = slidingWindowFilter(gammaRayWindow, gammaRay);

        double porosity = computeWylliePorosity(transitTimeFiltered, gammaRayFiltered);

        double porosityDelta = Double.isNaN(previousPorosity) ? 0.0 : Math.abs(porosity - previousPorosity);
        previousPorosity = porosity;

        LithologyAlert.LithologyType lithoType = classifyLithology(gammaRayFiltered);
        LithologyAlert.AlertLevel alertLevel = LithologyAlert.AlertLevel.NORMAL;
        String message = "";

        if (isGasZone(porosity, gammaRayFiltered, transitTimeFiltered)) {
            lithoType = LithologyAlert.LithologyType.GAS_ZONE;
            alertLevel = LithologyAlert.AlertLevel.CRITICAL;
            message = String.format("⚠ 气层预警 | 孔隙度=%.1f%% GR=%.1fAPI Δt=%.1fμs/ft",
                    porosity * 100, gammaRayFiltered, transitTimeFiltered);
        } else if (isWaterZone(porosity, gammaRayFiltered, attenuationFiltered)) {
            lithoType = LithologyAlert.LithologyType.WATER_ZONE;
            alertLevel = LithologyAlert.AlertLevel.WARNING;
            message = String.format("⚠ 水层预警 | 孔隙度=%.1f%% GR=%.1fAPI 衰减=%.2f",
                    porosity * 100, gammaRayFiltered, attenuationFiltered);
        } else if (porosityDelta > POROSITY_MUTATION_THRESHOLD) {
            alertLevel = LithologyAlert.AlertLevel.WARNING;
            message = String.format("孔隙度突变 | Δφ=%.1f%% (%.1f%%→%.1f%%)",
                    porosityDelta * 100, (porosity - porosityDelta) * 100, porosity * 100);
        }

        return LithologyAlert.builder()
                .frameSequence(frame.getFrameSequence())
                .bitDepth(frame.getBitDepth())
                .alertLevel(alertLevel)
                .lithologyType(lithoType)
                .transitTimeFiltered((float) transitTimeFiltered)
                .attenuationFiltered((float) attenuationFiltered)
                .gammaRayFiltered((float) gammaRayFiltered)
                .porosity((float) porosity)
                .porosityDelta((float) porosityDelta)
                .message(message)
                .build();
    }

    private double extractTransitTime(float[] pWave) {
        double peakAmplitude = 0;
        int peakIndex = 0;
        double rmsThreshold = computeRms(pWave) * 2.5;

        for (int i = 1; i < pWave.length; i++) {
            double absVal = Math.abs(pWave[i]);
            if (absVal > rmsThreshold && absVal > peakAmplitude) {
                peakAmplitude = absVal;
                peakIndex = i;
            }
        }

        if (peakIndex > 0) {
            int zeroCrossing = findFirstZeroCrossingAfterThreshold(pWave, peakIndex, rmsThreshold * 0.3);
            if (zeroCrossing > 0) {
                return zeroCrossing * SAMPLE_INTERVAL_US;
            }
        }

        return peakIndex * SAMPLE_INTERVAL_US;
    }

    private int findFirstZeroCrossingAfterThreshold(float[] data, int startIdx, double threshold) {
        for (int i = Math.max(1, startIdx - 5); i < Math.min(data.length - 1, startIdx + 50); i++) {
            if (Math.abs(data[i]) > threshold &&
                    ((data[i] >= 0 && data[i + 1] < 0) || (data[i] < 0 && data[i + 1] >= 0))) {
                return i;
            }
        }
        return startIdx;
    }

    private double extractAttenuation(float[] pWave) {
        if (pWave.length < 20) return 0;

        double firstPeak = 0;
        double lateAmplitude = 0;
        int quarterLen = pWave.length / 4;

        for (int i = 0; i < quarterLen; i++) {
            firstPeak = Math.max(firstPeak, Math.abs(pWave[i]));
        }
        for (int i = quarterLen * 2; i < quarterLen * 3; i++) {
            lateAmplitude += Math.abs(pWave[i]);
        }
        lateAmplitude /= quarterLen;

        if (firstPeak < 1e-6) return 0;
        return 1.0 - (lateAmplitude / firstPeak);
    }

    private double computeRms(float[] data) {
        double sum = 0;
        for (float v : data) {
            sum += v * v;
        }
        return Math.sqrt(sum / data.length);
    }

    private double slidingWindowFilter(LinkedList<Double> window, double newValue) {
        window.addLast(newValue);
        while (window.size() > SLIDING_WINDOW_SIZE) {
            window.removeFirst();
        }

        double sum = 0;
        double weightSum = 0;
        for (int i = 0; i < window.size(); i++) {
            double weight = i + 1;
            sum += window.get(i) * weight;
            weightSum += weight;
        }
        return sum / weightSum;
    }

    private double computeWylliePorosity(double transitTime, double gammaRay) {
        double dtMatrix = MATRIX_TRANSIT_TIME_US_FT;
        double dtFluid = FLUID_TRANSIT_TIME_US_FT;

        if (gammaRay < GAMMA_RAY_GAS_THRESHOLD) {
            dtFluid = GAS_TRANSIT_TIME_US_FT;
        }

        if (transitTime <= dtMatrix) {
            return 0;
        }

        double porosity = (transitTime - dtMatrix) / (dtFluid - dtMatrix);
        return Math.max(0, Math.min(1, porosity));
    }

    private LithologyAlert.LithologyType classifyLithology(double gammaRay) {
        if (gammaRay < GAMMA_RAY_GAS_THRESHOLD) {
            return LithologyAlert.LithologyType.SANDSTONE;
        } else if (gammaRay > GAMMA_RAY_SHALE_THRESHOLD) {
            return LithologyAlert.LithologyType.SHALE;
        }
        return LithologyAlert.LithologyType.SANDSTONE;
    }

    private boolean isGasZone(double porosity, double gammaRay, double transitTime) {
        return gammaRay < GAMMA_RAY_GAS_THRESHOLD &&
                porosity >= POROSITY_GAS_MIN &&
                transitTime > MATRIX_TRANSIT_TIME_US_FT * 1.5;
    }

    private boolean isWaterZone(double porosity, double gammaRay, double attenuation) {
        return gammaRay > GAMMA_RAY_GAS_THRESHOLD &&
                gammaRay < GAMMA_RAY_SHALE_THRESHOLD &&
                porosity >= POROSITY_WATER_MIN &&
                attenuation < ATTENUATION_WATER_MAX;
    }

    private LithologyAlert buildNormalAlert(MptFrame frame, double transitTime, double attenuation,
                                             double gammaRay, double porosity) {
        return LithologyAlert.builder()
                .frameSequence(frame.getFrameSequence())
                .bitDepth(frame.getBitDepth())
                .alertLevel(LithologyAlert.AlertLevel.NORMAL)
                .lithologyType(LithologyAlert.LithologyType.UNKNOWN)
                .transitTimeFiltered((float) transitTime)
                .attenuationFiltered((float) attenuation)
                .gammaRayFiltered((float) gammaRay)
                .porosity((float) porosity)
                .porosityDelta(0)
                .message("")
                .build();
    }

    public void reset() {
        transitTimeWindow.clear();
        attenuationWindow.clear();
        gammaRayWindow.clear();
        previousPorosity = Double.NaN;
    }
}
