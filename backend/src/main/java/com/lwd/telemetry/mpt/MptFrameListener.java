package com.lwd.telemetry.mpt;

import java.util.List;

public interface MptFrameListener {

    void onFrameDecoded(MptFrame frame);

    void onFrameError(int sequence, String error);

    void onSyncLost();
}
