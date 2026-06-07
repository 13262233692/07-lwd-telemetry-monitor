package com.lwd.telemetry.lithology;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class LithologyAlert {

    public enum AlertLevel {
        NORMAL,
        WARNING,
        CRITICAL
    }

    public enum LithologyType {
        SANDSTONE,
        SHALE,
        GAS_ZONE,
        WATER_ZONE,
        UNKNOWN
    }

    private int frameSequence;
    private float bitDepth;
    private AlertLevel alertLevel;
    private LithologyType lithologyType;

    private float transitTimeFiltered;
    private float attenuationFiltered;
    private float gammaRayFiltered;
    private float porosity;

    private float porosityDelta;
    private String message;
}
