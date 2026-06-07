package com.lwd.telemetry.controller;

import com.lwd.telemetry.websocket.TelemetryWebSocketHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class StatusController {

    private final TelemetryWebSocketHandler webSocketHandler;

    @GetMapping("/status")
    public Map<String, Object> getStatus() {
        return Map.of(
                "service", "LWD-MPT-Telemetry-Gateway",
                "status", "RUNNING",
                "wsClients", webSocketHandler.getClientCount(),
                "version", "1.0.0"
        );
    }
}
