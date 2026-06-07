package com.lwd.telemetry.netty;

import com.lwd.telemetry.mpt.MptFrame;
import com.lwd.telemetry.mpt.MptFrameListener;
import com.lwd.telemetry.websocket.TelemetryWebSocketHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class MptFrameDispatcher implements MptFrameListener {

    private final TelemetryWebSocketHandler webSocketHandler;

    @Override
    public void onFrameDecoded(MptFrame frame) {
        webSocketHandler.broadcastFrame(frame);
    }

    @Override
    public void onFrameError(int sequence, String error) {
        log.warn("Frame error at seq={}, reason={}", sequence, error);
    }

    @Override
    public void onSyncLost() {
        log.warn("MPT sync lost - attempting re-sync");
    }
}
