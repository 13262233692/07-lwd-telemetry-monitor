package com.lwd.telemetry.mpt;

import io.netty.util.AttributeKey;

public final class MptAttrKeys {

    public static final AttributeKey<MptFrame> PARTIAL_FRAME =
            AttributeKey.valueOf("mpt.partialFrame");

    private MptAttrKeys() {
    }
}
