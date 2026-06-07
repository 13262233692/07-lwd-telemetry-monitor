package com.lwd.telemetry.simulator;

import com.lwd.telemetry.mpt.MptConstants;
import com.lwd.telemetry.mpt.MptFrame;
import com.lwd.telemetry.websocket.TelemetryWebSocketHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.util.Random;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

@Slf4j
@Component
@RequiredArgsConstructor
public class MptSimulator implements CommandLineRunner {

    private final TelemetryWebSocketHandler webSocketHandler;
    private final AtomicInteger sequence = new AtomicInteger(0);
    private final Random random = new Random(42);
    private ScheduledExecutorService executor;
    private volatile boolean running = false;

    private static final double GAMMA_RAY_BASELINE = 45.0;
    private static final double GAMMA_RAY_SHALE = 120.0;
    private static final double GAMMA_RAY_GAS = 20.0;

    @Override
    public void run(String... args) throws Exception {
        start();
    }

    public void start() {
        if (running) return;
        running = true;
        executor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "mpt-simulator");
            t.setDaemon(true);
            return t;
        });

        executor.scheduleAtFixedRate(this::generateAndBroadcast, 500, 50, TimeUnit.MILLISECONDS);
        log.info("MPT Simulator started - generating frames every 50ms");
    }

    private void generateAndBroadcast() {
        try {
            int seq = sequence.getAndIncrement();
            int samples = MptConstants.WAVEFORM_SAMPLES_PER_FRAME;

            float[][] waveformData = new float[MptConstants.WAVEFORM_CHANNELS][samples];
            double bitDepth = 2500.0 + seq * 0.1;

            double gammaRay = generateGammaRay(seq);
            boolean isGasZone = isInGasZone(seq);
            boolean isWaterZone = isInWaterZone(seq);

            double pWaveFreq = isGasZone ? 10000.0 : (isWaterZone ? 11000.0 : 12000.0);
            double pWaveAmp = isGasZone ? 1.2 : (isWaterZone ? 0.5 : 0.8);
            double pWaveDecay = isGasZone ? 12000.0 : (isWaterZone ? 6000.0 : 8000.0);

            for (int s = 0; s < samples; s++) {
                double t = s / (double) MptConstants.WAVEFORM_SAMPLE_RATE_HZ;

                waveformData[MptConstants.WAVEFORM_P_WAVE][s] =
                        (float) (pWaveAmp * Math.sin(2 * Math.PI * pWaveFreq * t) *
                                Math.exp(-t * pWaveDecay) +
                                0.1 * (random.nextDouble() - 0.5));

                waveformData[MptConstants.WAVEFORM_S_WAVE][s] =
                        (float) (0.6 * Math.sin(2 * Math.PI * 8000 * t) *
                                Math.exp(-t * 5000) +
                                0.1 * (random.nextDouble() - 0.5));

                waveformData[MptConstants.WAVEFORM_STONELEY][s] =
                        (float) (0.4 * Math.sin(2 * Math.PI * 3000 * t) *
                                Math.exp(-t * 2000) +
                                0.05 * (random.nextDouble() - 0.5));
            }

            MptFrame frame = MptFrame.builder()
                    .syncWord(MptConstants.FRAME_SYNC_WORD)
                    .frameLength(MptConstants.FRAME_TOTAL_SIZE)
                    .frameSequence(seq)
                    .frameType((short) 1)
                    .statusCode((short) 0)
                    .bitDepth((float) bitDepth)
                    .temperature((float) (150.0 + random.nextDouble() * 10))
                    .mudPressure((float) (5000.0 + random.nextDouble() * 200))
                    .gammaRay((float) gammaRay)
                    .channelMask((short) 0x07)
                    .sampleCount(samples)
                    .waveformData(waveformData)
                    .build();

            webSocketHandler.broadcastFrame(frame);
        } catch (Exception e) {
            log.error("Simulator error", e);
        }
    }

    private double generateGammaRay(int seq) {
        double cyclePos = (seq % 400) / 400.0;

        double base;
        if (cyclePos < 0.25) {
            base = GAMMA_RAY_BASELINE;
        } else if (cyclePos < 0.4) {
            double t = (cyclePos - 0.25) / 0.15;
            base = GAMMA_RAY_BASELINE + (GAMMA_RAY_SHALE - GAMMA_RAY_BASELINE) * t;
        } else if (cyclePos < 0.55) {
            base = GAMMA_RAY_SHALE;
        } else if (cyclePos < 0.65) {
            double t = (cyclePos - 0.55) / 0.10;
            base = GAMMA_RAY_SHALE + (GAMMA_RAY_GAS - GAMMA_RAY_SHALE) * t;
        } else if (cyclePos < 0.80) {
            base = GAMMA_RAY_GAS;
        } else {
            double t = (cyclePos - 0.80) / 0.20;
            base = GAMMA_RAY_GAS + (GAMMA_RAY_BASELINE - GAMMA_RAY_GAS) * t;
        }

        return base + (random.nextDouble() - 0.5) * 8.0;
    }

    private boolean isInGasZone(int seq) {
        double cyclePos = (seq % 400) / 400.0;
        return cyclePos >= 0.65 && cyclePos < 0.80;
    }

    private boolean isInWaterZone(int seq) {
        double cyclePos = (seq % 400) / 400.0;
        return cyclePos >= 0.40 && cyclePos < 0.50;
    }

    public void stop() {
        running = false;
        if (executor != null) {
            executor.shutdownNow();
        }
        log.info("MPT Simulator stopped");
    }
}
