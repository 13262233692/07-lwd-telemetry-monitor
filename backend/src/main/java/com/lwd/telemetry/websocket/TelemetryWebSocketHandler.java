package com.lwd.telemetry.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lwd.telemetry.lithology.LithologyAlert;
import com.lwd.telemetry.mpt.MptConstants;
import com.lwd.telemetry.mpt.MptFrame;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

@Slf4j
@Component
public class TelemetryWebSocketHandler extends AbstractWebSocketHandler {

    private static final byte MSG_TYPE_FRAME = 0x01;
    private static final byte MSG_TYPE_ALERT = 0x02;

    private final List<WebSocketSession> sessions = new CopyOnWriteArrayList<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        sessions.add(session);
        log.info("WebSocket client connected: {}, total clients: {}", session.getId(), sessions.size());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        sessions.remove(session);
        log.info("WebSocket client disconnected: {}, total clients: {}", session.getId(), sessions.size());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        if ("PING".equals(payload)) {
            session.sendMessage(new TextMessage("PONG"));
        }
    }

    public void broadcastFrame(MptFrame frame) {
        if (sessions.isEmpty()) {
            return;
        }

        try {
            ByteBuffer binaryPayload = serializeFrameToBinary(frame);
            sendToAll(binaryPayload);
        } catch (Exception e) {
            log.error("Error serializing frame for broadcast", e);
        }
    }

    public void broadcastAlert(LithologyAlert alert) {
        if (sessions.isEmpty()) {
            return;
        }

        try {
            String json = objectMapper.writeValueAsString(alert);
            ByteBuffer payload = ByteBuffer.allocate(1 + json.getBytes().length);
            payload.put(MSG_TYPE_ALERT);
            payload.put(json.getBytes());
            payload.flip();
            sendToAll(payload);
        } catch (Exception e) {
            log.error("Error serializing alert for broadcast", e);
        }
    }

    private void sendToAll(ByteBuffer payload) {
        for (WebSocketSession session : sessions) {
            if (session.isOpen()) {
                try {
                    session.sendMessage(new BinaryMessage(payload.duplicate()));
                } catch (IOException e) {
                    log.warn("Failed to send to session {}: {}", session.getId(), e.getMessage());
                    sessions.remove(session);
                }
            }
        }
    }

    private ByteBuffer serializeFrameToBinary(MptFrame frame) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream(8 + 20 +
                (frame.getWaveformData() != null ?
                        frame.getSampleCount() * MptConstants.WAVEFORM_CHANNELS * 2 : 0));
        DataOutputStream dos = new DataOutputStream(baos);

        dos.writeByte(MSG_TYPE_FRAME);
        dos.writeInt(MptConstants.FRAME_SYNC_WORD);

        int frameLen = MptConstants.FRAME_HEADER_SIZE +
                frame.getSampleCount() * MptConstants.WAVEFORM_CHANNELS * 2 + 4;
        dos.writeInt(frameLen);
        dos.writeInt(frame.getFrameSequence());

        int typeStatus = ((frame.getFrameType() & 0xFF) << 8) | (frame.getStatusCode() & 0xFF);
        dos.writeShort(typeStatus);

        dos.writeInt(Float.floatToRawIntBits(frame.getBitDepth()));
        dos.writeInt(Float.floatToRawIntBits(frame.getTemperature()));
        dos.writeInt(Float.floatToRawIntBits(frame.getMudPressure()));
        dos.writeInt(Float.floatToRawIntBits(frame.getGammaRay()));

        int maskSample = ((frame.getChannelMask() & 0x0F) << 12) | (frame.getSampleCount() & 0x0FFF);
        dos.writeShort(maskSample);

        if (frame.getWaveformData() != null) {
            for (int ch = 0; ch < MptConstants.WAVEFORM_CHANNELS; ch++) {
                if ((frame.getChannelMask() & (1 << ch)) != 0 && ch < frame.getWaveformData().length) {
                    for (int s = 0; s < frame.getSampleCount(); s++) {
                        short raw = (short) (frame.getWaveformData()[ch][s] * 32768.0f);
                        dos.writeShort(raw);
                    }
                }
            }
        }

        dos.writeInt(0);

        byte[] data = baos.toByteArray();
        return ByteBuffer.wrap(data);
    }

    public int getClientCount() {
        return sessions.size();
    }
}
